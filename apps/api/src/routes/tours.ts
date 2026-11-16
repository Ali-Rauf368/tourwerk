import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Deps, Guard } from '../deps';
import { HttpError, notFound, parse } from '../http/errors';
import { DAY_RE, dayDate, localDay, localMinute } from '../services/clock';
import { FAIL_REASONS } from '../services/tours';

const stopEventInput = z.object({ event: z.enum(['ARRIVED', 'DELIVERED', 'FAILED']), reason: z.enum(FAIL_REASONS).optional() });

export function tourRoutes({ db, tours, sim, telemetry, config, eta }: Deps, guard: Guard) {
  const r = Router();

  const tourInclude = {
    vehicle: { include: { driver: { select: { id: true, name: true } } } },
    depot: true,
    stops: { orderBy: { seq: 'asc' as const }, include: { order: true } },
  };

  /** Drivers may only touch the tour of the vehicle assigned to them. */
  async function assertAccess(req: Request, tourId: string) {
    const tour = await db.tour.findUnique({ where: { id: tourId }, include: { vehicle: { select: { driverId: true } } } });
    if (!tour) throw notFound('Tour');
    if (req.user!.role === 'DRIVER' && tour.vehicle.driverId !== req.user!.id) throw new HttpError(403, 'This is not your tour');
    return tour;
  }

  r.get('/', guard.dispatcher, async (req, res) => {
    const day = parse(z.object({ day: z.string().regex(DAY_RE).optional() }), req.query).day ?? localDay();
    const list = await db.tour.findMany({ where: { day: dayDate(day) }, include: tourInclude, orderBy: { vehicle: { plate: 'asc' } } });
    res.json(list.map((t) => ({ ...t, simulating: sim.isRunning(t.id) })));
  });

  /** Live arrival forecasts for every running tour of today, most at-risk first. */
  r.get('/eta', guard.dispatcher, async (_req, res) => {
    const running = await db.tour.findMany({ where: { day: dayDate(localDay()), status: 'IN_PROGRESS' }, select: { id: true } });
    const now = localMinute(new Date());
    const list = (await Promise.all(running.map((t) => eta.predict(t.id, sim.isRunning(t.id) ? undefined : now)))).filter((p) => p !== null);
    res.json(list.sort((a, b) => b.late - a.late || b.tight - a.tight || b.delayMin - a.delayMin));
  });

  /** The signed-in driver's tour for today (or null). */
  r.get('/mine', guard.driver, async (req, res) => {
    const tour = await db.tour.findFirst({ where: { day: dayDate(localDay()), vehicle: { driverId: req.user!.id } }, include: tourInclude });
    res.json(tour);
  });

  r.get('/:id', guard.driver, async (req, res) => {
    await assertAccess(req, String(req.params.id));
    const tour = await db.tour.findUniqueOrThrow({ where: { id: String(req.params.id) }, include: tourInclude });
    res.json({ ...tour, simulating: sim.isRunning(tour.id) });
  });

  r.get('/:id/eta', guard.driver, async (req, res) => {
    const tour = await assertAccess(req, String(req.params.id));
    if (tour.status !== 'IN_PROGRESS') throw new HttpError(409, 'Forecasts exist only for running tours');
    res.json(await eta.predict(tour.id, sim.isRunning(tour.id) ? undefined : localMinute(new Date())));
  });

  r.get('/:id/trail', guard.driver, async (req, res) => {
    await assertAccess(req, String(req.params.id));
    res.json(await telemetry.trail(String(req.params.id)));
  });

  r.post('/:id/start', guard.driver, async (req, res) => {
    await assertAccess(req, String(req.params.id));
    res.json(await tours.start(String(req.params.id), req.user!.name));
  });

  /** Start a tour and let the C fleet simulator drive it (demo / load test). */
  r.post('/:id/simulate', guard.dispatcher, async (req, res) => {
    const id = String(req.params.id);
    const tour = await assertAccess(req, id);
    if (!sim.available) throw new HttpError(503, 'Fleet simulator is not built (run `npm run native`)');
    if (tour.status === 'COMPLETED') throw new HttpError(409, 'Tour is already completed');
    if (tour.status === 'PLANNED') await tours.start(id, req.user!.name);
    void sim.drive(id);
    res.status(202).json({ simulating: true, speedup: config.SIM_SPEEDUP });
  });

  r.post('/:id/stops/:stopId', guard.driver, async (req, res) => {
    await assertAccess(req, String(req.params.id));
    const stop = await db.stop.findFirst({ where: { id: String(req.params.stopId), tourId: String(req.params.id) } });
    if (!stop) throw notFound('Stop');
    const { event, reason } = parse(stopEventInput, req.body);
    res.json(await tours.stopEvent(stop.id, event, { reason, actor: req.user!.name }));
  });

  return r;
}
