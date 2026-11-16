import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Db } from '../db/prisma';
import type { TelemetryStore } from '../telemetry/store';
import type { Notify } from '../services/notify';
import type { TourService } from '../services/tours';

export interface SimOptions {
  binary: string;
  speedup: number;
  tickMs: number;
  failRate: number;
  /** Share of legs that hit congestion (0 = none). */
  jamRate?: number;
}

/**
 * Drives started tours with the C tracker (native/tracker). One child process per tour;
 * its stdout events become GPS fixes (MongoDB), stop updates (PostgreSQL) and live
 * Socket.IO messages. The simulated service clock starts at the depot's shift start.
 */
export class FleetSimulator {
  private readonly children = new Map<string, ChildProcess>();
  private readonly active = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly tours: TourService,
    private readonly telemetry: TelemetryStore,
    private readonly notify: Notify,
    private readonly opts: SimOptions,
    private readonly log: (m: string) => void = () => {},
  ) {}

  get available() {
    return existsSync(this.opts.binary);
  }

  isRunning(tourId: string) {
    return this.active.has(tourId);
  }

  /** Resolves when the tour's simulation (if any) has finished and all events are applied. */
  async wait(tourId: string) {
    await this.active.get(tourId);
  }

  /** Start driving a tour. Registered synchronously, so isRunning() is true immediately. */
  drive(tourId: string): Promise<void> {
    if (!this.available) return Promise.reject(new Error('Fleet simulator is not built (run `npm run native`)'));
    const existing = this.active.get(tourId);
    if (existing) return existing;
    const run = this.run(tourId)
      .catch((e) => this.log(`sim ${tourId.slice(0, 8)} failed: ${e instanceof Error ? e.message : e}`))
      .finally(() => this.active.delete(tourId));
    this.active.set(tourId, run);
    return run;
  }

  private async run(tourId: string): Promise<void> {
    const tour = await this.db.tour.findUniqueOrThrow({
      where: { id: tourId },
      include: { depot: true, stops: { orderBy: { seq: 'asc' }, include: { order: true } } },
    });
    const pending = tour.stops.filter((s) => s.status === 'PENDING' || s.status === 'ARRIVED');
    const stopById = new Map(tour.stops.map((s) => [s.id, s]));
    const { speedup, tickMs, failRate } = this.opts;
    const child = spawn(this.opts.binary, ['--tick-ms', String(tickMs), '--speedup', String(speedup), '--fail-rate', String(failRate), '--jam-rate', String(this.opts.jamRate ?? 0), '--seed', String(parseInt(tourId.slice(0, 6), 16))], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.children.set(tourId, child);
    const startedReal = Date.now();
    const clock = () => Math.round(tour.depot.shiftStart + ((Date.now() - startedReal) / 60_000) * speedup);

    let chain: Promise<unknown> = Promise.resolve(); // apply events strictly in order
    const enqueue = (fn: () => Promise<unknown>) => {
      chain = chain.then(fn).catch((e) => this.log(`sim ${tourId.slice(0, 8)}: ${e instanceof Error ? e.message : e}`));
    };

    createInterface({ input: child.stdout }).on('line', (line) => {
      const [kind, ...f] = line.split(' ');
      if (kind === 'POS') {
        const [lat, lng, speedKmh, heading, next] = f.map(Number);
        const fix = { vehicleId: tour.vehicleId, tourId, ts: new Date(), lat, lng, speedKmh, heading };
        this.notify.position({ ...fix, nextSeq: pending[next]?.seq ?? 0, clockMin: clock() });
        enqueue(() => this.telemetry.insert(fix));
      } else if (kind === 'ARRIVED' || kind === 'DELIVERED' || kind === 'FAILED') {
        const stopId = f[0];
        if (!stopById.has(stopId)) return;
        enqueue(() => this.tours.stopEvent(stopId, kind, { reason: f[1], clockMin: clock(), actor: 'simulator' }));
      } else if (kind === 'DONE') {
        enqueue(() => this.tours.completeIfDone(tourId, Number(f[0])));
      }
    });

    child.stdin.write(`TOUR ${tourId}\nDEPOT ${tour.depot.lat} ${tour.depot.lng}\nCLOCK ${tour.depot.shiftStart}\n`);
    for (const s of pending) child.stdin.write(`STOP ${s.id} ${s.order.lat} ${s.order.lng} ${s.order.serviceMin * 60} ${s.order.windowStart}\n`);
    child.stdin.end('GO\n');

    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    this.children.delete(tourId);
    await chain; // apply every event before the tour counts as no longer simulating
  }

  stopAll() {
    for (const child of this.children.values()) child.kill();
    this.children.clear();
  }
}
