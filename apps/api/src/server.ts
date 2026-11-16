import http from 'node:http';
import type { Server } from 'socket.io';
import { createApp } from './app';
import { EtaService } from './services/eta';
import { loadConfig } from './config';
import { createPrisma } from './db/prisma';
import { MemoryErpExporter, MysqlErpExporter, type ErpExporter } from './erp/exporter';
import { createOptimizer } from './optimizer';
import { createRealtime, socketNotify } from './realtime';
import { DEMO_PASSWORD, seed } from './seed';
import { TourService } from './services/tours';
import { FleetSimulator } from './sim/fleet';
import { MongoTelemetryStore } from './telemetry/mongo-store';
import { MemoryTelemetryStore, type TelemetryStore } from './telemetry/store';

async function main() {
  const config = loadConfig();
  const log = (m: string) => console.log(`[tourwerk] ${m}`);
  const db = createPrisma(config.DATABASE_URL);

  let telemetry: TelemetryStore;
  if (config.MONGO_URL) {
    telemetry = await MongoTelemetryStore.connect(config.MONGO_URL);
    log('telemetry: MongoDB time-series collection');
  } else {
    if (config.NODE_ENV === 'production') throw new Error('MONGO_URL is required in production');
    telemetry = new MemoryTelemetryStore();
    log('telemetry: in-memory store (set MONGO_URL to use MongoDB)');
  }
  const erp: ErpExporter = config.MYSQL_URL ? MysqlErpExporter.create(config.MYSQL_URL) : new MemoryErpExporter();
  log(`erp export: ${erp.kind === 'mysql' ? 'MySQL' : 'in-memory outbox (set MYSQL_URL to use MySQL)'}`);

  if (await seed(db, log)) log(`seeded demo data. Password for all demo users: ${DEMO_PASSWORD}`);

  const optimizer = createOptimizer(config.OPTIMIZER_PATH, log);
  let io: Server | undefined;
  const eta = new EtaService(db);
  const notify = eta.decorate(socketNotify(() => io));
  const tours = new TourService(db, erp, notify, log);
  const sim = new FleetSimulator(db, tours, telemetry, notify, { binary: config.TRACKER_PATH, speedup: config.SIM_SPEEDUP, tickMs: config.SIM_TICK_MS, failRate: config.SIM_FAIL_RATE, jamRate: config.SIM_JAM_RATE }, log);

  const app = createApp({ config, db, optimizer, telemetry, erp, notify, tours, sim, eta });
  const server = http.createServer(app);
  io = createRealtime(server, config.JWT_SECRET, async (userId) => (await db.vehicle.findUnique({ where: { driverId: userId }, select: { id: true } }))?.id ?? null);

  const timers = [
    // Retry ERP exports that failed earlier (e.g. MySQL was down).
    setInterval(() => tours.exportPending().catch((e) => log(`erp export retry failed: ${e}`)), 60_000),
  ];
  server.listen(config.PORT, () => log(`API on http://localhost:${config.PORT}`));

  const shutdown = async () => {
    log('shutting down');
    timers.forEach(clearInterval);
    sim.stopAll();
    io?.close();
    server.close();
    await Promise.allSettled([telemetry.close(), erp.close(), db.$disconnect()]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
