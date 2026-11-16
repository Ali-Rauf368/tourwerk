import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPrisma } from '../src/db/prisma';
import { MemoryErpExporter } from '../src/erp/exporter';
import { createOptimizer } from '../src/optimizer';
import { DEMO_PASSWORD, seed } from '../src/seed';
import type { Notify } from '../src/services/notify';
import { EtaService } from '../src/services/eta';
import { TourService } from '../src/services/tours';
import { FleetSimulator } from '../src/sim/fleet';
import { MemoryTelemetryStore } from '../src/telemetry/store';
import { TEST_DB } from './global-setup';

/** A fully wired app on the test database, with in-memory telemetry/ERP and recorded events. */
export async function setup() {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, JWT_SECRET: 'test-secret-test-secret', INTEGRATION_TOKEN: 'test-integration-token', SIM_SPEEDUP: '3000', SIM_TICK_MS: '5', SIM_FAIL_RATE: '0', OPTIMIZER_SEARCH_MS: '300' });
  const db = createPrisma(config.DATABASE_URL);
  await db.$executeRawUnsafe('TRUNCATE "AuditEvent", "Stop", "Tour", "Order", "Vehicle", "Depot", "User" CASCADE');
  await seed(db);
  const events: { type: string; payload: unknown }[] = [];
  const notify: Notify = {
    position: (p) => events.push({ type: 'position', payload: p }),
    stop: (p) => events.push({ type: 'stop', payload: p }),
    tour: (p) => events.push({ type: 'tour', payload: p }),
    orders: (p) => events.push({ type: 'orders', payload: p }),
    eta: (p) => events.push({ type: 'eta', payload: p }),
  };
  const eta = new EtaService(db, 0);
  const notifyAll = eta.decorate(notify);
  const telemetry = new MemoryTelemetryStore();
  const erp = new MemoryErpExporter();
  const optimizer = createOptimizer(config.OPTIMIZER_PATH, () => {});
  const tours = new TourService(db, erp, notifyAll);
  const sim = new FleetSimulator(db, tours, telemetry, notifyAll, { binary: config.TRACKER_PATH, speedup: config.SIM_SPEEDUP, tickMs: config.SIM_TICK_MS, failRate: config.SIM_FAIL_RATE });
  const app = createApp({ config, db, optimizer, telemetry, erp, notify: notifyAll, tours, sim, eta });

  const tokens = new Map<string, string>();
  const login = async (email: string) => {
    if (!tokens.has(email)) {
      const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD }).expect(200);
      tokens.set(email, res.body.token);
    }
    return { authorization: `Bearer ${tokens.get(email)}` };
  };
  return { app, db, config, erp, telemetry, events, sim, optimizer, eta, login, close: () => db.$disconnect() };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;
export const DISPO = 'dispo@tourwerk.de';
export const ADMIN = 'admin@tourwerk.de';
export const DRIVER1 = 'fahrer1@tourwerk.de';
export const DRIVER2 = 'fahrer2@tourwerk.de';

/** Optimize a day and commit the proposal unchanged. */
export async function planDay(ctx: Ctx, day: string) {
  const h = await ctx.login(DISPO);
  const plan = (await request(ctx.app).post('/api/planning/optimize').set(h).send({ day }).expect(200)).body;
  const body = {
    day,
    engine: plan.engine,
    routes: plan.routes.map((r: { vehicleId: string; distanceKm: number; returnMin: number; stops: { orderId: string; etaMin: number }[] }) => ({
      vehicleId: r.vehicleId,
      distanceKm: r.distanceKm,
      returnMin: r.returnMin,
      stops: r.stops.map((s) => ({ orderId: s.orderId, etaMin: s.etaMin })),
    })),
  };
  return { plan, body };
}
