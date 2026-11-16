import { z } from 'zod';
import type { Db } from '../db/prisma';
import { HttpError } from '../http/errors';
import type { Optimizer, OptimizerResult } from '../optimizer';
import { dayDate } from './clock';
import { haversineKm } from './geo';

export const AVERAGE_SPEED_KMH = 26;

export const commitInput = z.object({
  day: z.string(),
  engine: z.enum(['native', 'typescript']),
  routes: z
    .array(
      z.object({
        vehicleId: z.string().uuid(),
        distanceKm: z.number().nonnegative(),
        returnMin: z.number().int(),
        stops: z.array(z.object({ orderId: z.string().uuid(), etaMin: z.number().int().min(0).max(1440) })).min(1),
      }),
    )
    .min(1),
});

/** The depot all planning runs against (single-depot deployment). */
export async function primaryDepot(db: Db) {
  const depot = await db.depot.findFirst({ orderBy: { name: 'asc' } });
  if (!depot) throw new HttpError(409, 'No depot configured');
  return depot;
}

/**
 * Optimize all unplanned orders of a day across the vehicles that do not have a tour yet.
 * Nothing is written: the dispatcher reviews the proposal and then commits it.
 */
export async function proposePlan(db: Db, optimizer: Optimizer, day: string, searchMs = 0) {
  const depot = await primaryDepot(db);
  const date = dayDate(day);
  const [vehicles, orders] = await Promise.all([
    db.vehicle.findMany({
      where: { depotId: depot.id, active: true, tours: { none: { day: date } } },
      orderBy: { plate: 'asc' },
      include: { driver: { select: { id: true, name: true } } },
    }),
    db.order.findMany({ where: { depotId: depot.id, deliveryDay: date, status: 'NEW' }, orderBy: { number: 'asc' } }),
  ]);
  const empty: OptimizerResult = { engine: optimizer.name, routes: [], unassigned: orders.map((o) => o.id), totalKm: 0, improvements: 0, elapsedMs: 0, iterations: 0, initialKm: 0, trace: [], operators: [] };
  const result =
    vehicles.length && orders.length
      ? await optimizer.solve({
          depot: { lat: depot.lat, lng: depot.lng, shiftStart: depot.shiftStart, shiftEnd: depot.shiftEnd },
          speedKmh: AVERAGE_SPEED_KMH,
          vehicles: vehicles.map((v) => ({ id: v.id, capacityKg: v.capacityKg })),
          orders: orders.map((o) => ({ id: o.id, lat: o.lat, lng: o.lng, weightKg: o.weightKg, serviceMin: o.serviceMin, windowStart: o.windowStart, windowEnd: o.windowEnd })),
          // Fixed seed per day: re-running the same day gives the same proposal unless the time budget cuts it short.
          search: searchMs > 0 ? { timeMs: searchMs, seed: Number(day.replaceAll('-', '')) } : undefined,
        })
      : empty;

  // Baseline for the "savings" figure: every order served by its own depot round trip.
  const baselineKm = orders.reduce((s, o) => s + 2 * 1.3 * haversineKm(depot, o), 0);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  return {
    day,
    depot,
    engine: result.engine,
    elapsedMs: result.elapsedMs,
    improvements: result.improvements,
    search: { iterations: result.iterations, initialKm: +result.initialKm.toFixed(2), trace: result.trace, operators: result.operators },
    totalKm: +result.totalKm.toFixed(2),
    baselineKm: +baselineKm.toFixed(2),
    vehiclesAvailable: vehicles.length,
    routes: result.routes.map((r) => {
      const v = vehicleById.get(r.vehicleId)!;
      return {
        ...r,
        vehicle: { id: v.id, plate: v.plate, label: v.label, capacityKg: v.capacityKg, electric: v.electric, driver: v.driver },
        utilization: +(r.loadKg / v.capacityKg).toFixed(3),
        stops: r.stops.map((s) => {
          const o = byId.get(s.orderId)!;
          return { ...s, number: o.number, customer: o.customer, street: o.street, postcode: o.postcode, lat: o.lat, lng: o.lng, weightKg: o.weightKg, windowStart: o.windowStart, windowEnd: o.windowEnd };
        }),
      };
    }),
    unassigned: result.unassigned.map((id) => byId.get(id)!).map((o) => ({ id: o.id, number: o.number, customer: o.customer, weightKg: o.weightKg, windowStart: o.windowStart, windowEnd: o.windowEnd, lat: o.lat, lng: o.lng })),
  };
}

/**
 * Turn a reviewed proposal into tours. Runs in one transaction and claims orders with a
 * conditional update (status NEW → PLANNED), so two dispatchers committing at the same
 * time cannot plan the same order twice; the loser gets a 409 and nothing is written.
 */
export async function commitPlan(db: Db, input: z.infer<typeof commitInput>, actor: string) {
  const depot = await primaryDepot(db);
  const date = dayDate(input.day);
  const orderIds = input.routes.flatMap((r) => r.stops.map((s) => s.orderId));
  if (new Set(orderIds).size !== orderIds.length) throw new HttpError(400, 'An order appears in more than one stop');
  if (new Set(input.routes.map((r) => r.vehicleId)).size !== input.routes.length) throw new HttpError(400, 'A vehicle appears in more than one route');

  return db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { id: { in: orderIds } } });
    const vehicles = await tx.vehicle.findMany({ where: { id: { in: input.routes.map((r) => r.vehicleId) }, active: true } });
    const weight = new Map(orders.map((o) => [o.id, o.weightKg]));
    for (const r of input.routes) {
      const v = vehicles.find((x) => x.id === r.vehicleId);
      if (!v) throw new HttpError(400, 'Unknown or inactive vehicle');
      const load = r.stops.reduce((s, x) => s + (weight.get(x.orderId) ?? 0), 0);
      if (load > v.capacityKg + 1e-6) throw new HttpError(400, `${v.plate} would be overloaded (${load.toFixed(0)} / ${v.capacityKg} kg)`);
    }
    const claimed = await tx.order.updateMany({ where: { id: { in: orderIds }, status: 'NEW', deliveryDay: date }, data: { status: 'PLANNED' } });
    if (claimed.count !== orderIds.length) throw new HttpError(409, 'Some orders were changed or planned in the meantime. Please optimize again.');

    const tours = [];
    for (const r of input.routes) {
      const loadKg = r.stops.reduce((s, x) => s + (weight.get(x.orderId) ?? 0), 0);
      try {
        tours.push(
          await tx.tour.create({
            data: {
              day: date,
              depotId: depot.id,
              vehicleId: r.vehicleId,
              plannedKm: r.distanceKm,
              plannedReturn: r.returnMin,
              loadKg,
              optimizerEngine: input.engine,
              stops: { create: r.stops.map((s, i) => ({ seq: i + 1, etaMin: s.etaMin, orderId: s.orderId })) },
            },
          }),
        );
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'A vehicle already has a tour on this day');
        throw e;
      }
    }
    await tx.auditEvent.create({ data: { actor, action: 'plan.commit', subject: input.day, detail: { tours: tours.length, orders: orderIds.length, engine: input.engine } } });
    return tours;
  });
}

/** Daily cost model for the fleet what-if: a van-day (driver + lease) plus energy/wear per km. */
export const COST = { perVanDay: 210, perKm: 0.38, perUnassigned: 25 };

/**
 * Fleet-size what-if: solve the day's open orders with the k largest free vans for every
 * k, in parallel native processes, and report distance, unserved orders, the last return
 * and a daily cost. The recommendation is the cheapest k that serves every order.
 */
export async function fleetScenarios(db: Db, optimizer: Optimizer, day: string, searchMs = 400) {
  const depot = await primaryDepot(db);
  const date = dayDate(day);
  const [vehicles, orders] = await Promise.all([
    db.vehicle.findMany({ where: { depotId: depot.id, active: true, tours: { none: { day: date } } }, orderBy: [{ capacityKg: 'desc' }, { plate: 'asc' }] }),
    db.order.findMany({ where: { depotId: depot.id, deliveryDay: date, status: 'NEW' } }),
  ]);
  if (!orders.length || !vehicles.length) return { day, orders: 0, scenarios: [], recommended: null };
  const base = {
    depot: { lat: depot.lat, lng: depot.lng, shiftStart: depot.shiftStart, shiftEnd: depot.shiftEnd },
    speedKmh: AVERAGE_SPEED_KMH,
    orders: orders.map((o) => ({ id: o.id, lat: o.lat, lng: o.lng, weightKg: o.weightKg, serviceMin: o.serviceMin, windowStart: o.windowStart, windowEnd: o.windowEnd })),
  };
  const seed = Number(day.replaceAll('-', ''));
  const scenarios = await Promise.all(
    vehicles.map(async (_, i) => {
      const fleet = vehicles.slice(0, i + 1);
      const r = await optimizer.solve({ ...base, vehicles: fleet.map((v) => ({ id: v.id, capacityKg: v.capacityKg })), search: searchMs > 0 ? { timeMs: searchMs, seed } : undefined });
      const vansUsed = r.routes.length;
      const capacityKg = fleet.reduce((s, v) => s + v.capacityKg, 0);
      const servedKg = r.routes.reduce((s, x) => s + x.loadKg, 0);
      return {
        vans: i + 1,
        vansUsed,
        plates: fleet.map((v) => v.plate),
        totalKm: +r.totalKm.toFixed(2),
        unassigned: r.unassigned.length,
        lastReturn: r.routes.reduce((m, x) => Math.max(m, x.returnMin), 0) || null,
        utilization: +(servedKg / capacityKg).toFixed(3),
        costEur: Math.round(vansUsed * COST.perVanDay + r.totalKm * COST.perKm + r.unassigned.length * COST.perUnassigned),
      };
    }),
  );
  const full = scenarios.filter((s) => s.unassigned === 0);
  const recommended = (full.length ? full : scenarios).reduce((a, b) => (b.costEur < a.costEur ? b : a)).vans;
  return { day, orders: orders.length, cost: COST, scenarios, recommended };
}
