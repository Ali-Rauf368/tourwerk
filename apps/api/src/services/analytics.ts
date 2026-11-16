import type { Db } from '../db/prisma';
import { addDays, dayDate } from './clock';

/*
 * KPI queries in hand-written SQL. They aggregate in PostgreSQL instead of loading rows
 * into Node, and each one is backed by an index from the schema:
 *   Order(deliveryDay, status), Tour(day, status), Stop.orderId (unique).
 * `EXPLAIN ANALYZE` plans for the seeded data are documented in docs/QUERIES.md.
 */

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a: number, b: number) => (b ? +((a / b) * 100).toFixed(1) : null);

export async function daySummary(db: Db, day: string) {
  const d = dayDate(day);
  const [orders] = await db.$queryRaw<Record<string, bigint | number | null>[]>`
    SELECT COUNT(*)                                             AS total,
           COUNT(*) FILTER (WHERE o.status = 'NEW')             AS unplanned,
           COUNT(*) FILTER (WHERE o.status IN ('PLANNED', 'OUT_FOR_DELIVERY')) AS open,
           COUNT(*) FILTER (WHERE o.status = 'DELIVERED')       AS delivered,
           COUNT(*) FILTER (WHERE o.status = 'FAILED')          AS failed,
           COUNT(*) FILTER (WHERE o.status = 'DELIVERED' AND s."completedMin" <= o."windowEnd") AS on_time,
           COALESCE(SUM(o."weightKg"), 0)                       AS weight_kg,
           COALESCE(SUM(o.parcels), 0)                          AS parcels
    FROM "Order" o
    LEFT JOIN "Stop" s ON s."orderId" = o.id
    WHERE o."deliveryDay" = ${d} AND o.status <> 'CANCELLED'`;
  const [tours] = await db.$queryRaw<Record<string, bigint | number | null>[]>`
    SELECT COUNT(*)                                        AS tours,
           COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS') AS active,
           COALESCE(SUM(t."plannedKm"), 0)                  AS planned_km,
           COALESCE(SUM(t."drivenKm"), 0)                   AS driven_km,
           AVG(t."loadKg" / v."capacityKg")                 AS utilization,
           COALESCE(SUM(t."plannedKm") FILTER (WHERE v.electric), 0) AS electric_km
    FROM "Tour" t JOIN "Vehicle" v ON v.id = t."vehicleId"
    WHERE t.day = ${d}`;
  const delivered = num(orders.delivered);
  const failed = num(orders.failed);
  const plannedKm = num(tours.planned_km);
  const electricKm = num(tours.electric_km);
  return {
    day,
    orders: {
      total: num(orders.total),
      unplanned: num(orders.unplanned),
      open: num(orders.open),
      delivered,
      failed,
      weightKg: +num(orders.weight_kg).toFixed(1),
      parcels: num(orders.parcels),
    },
    successRate: pct(delivered, delivered + failed),
    onTimeRate: pct(num(orders.on_time), delivered),
    tours: { total: num(tours.tours), active: num(tours.active) },
    plannedKm: +plannedKm.toFixed(1),
    drivenKm: +num(tours.driven_km).toFixed(1),
    utilization: tours.utilization === null ? null : +(num(tours.utilization) * 100).toFixed(1),
    /** Diesel vans emit ~ 0.21 kg CO₂/km; electric km count as avoided emissions. */
    co2SavedKg: +(electricKm * 0.21).toFixed(1),
  };
}

/** Daily trend for the last `days` days (inclusive), with days without data filled in. */
export async function trend(db: Db, until: string, days = 14) {
  const from = dayDate(addDays(until, -(days - 1)));
  const to = dayDate(until);
  const rows = await db.$queryRaw<{ day: Date; delivered: bigint; failed: bigint; on_time: bigint; km: number | null }[]>`
    WITH days AS (
      SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
    ), o AS (
      SELECT o."deliveryDay" AS day,
             COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
             COUNT(*) FILTER (WHERE o.status = 'FAILED')    AS failed,
             COUNT(*) FILTER (WHERE o.status = 'DELIVERED' AND s."completedMin" <= o."windowEnd") AS on_time
      FROM "Order" o LEFT JOIN "Stop" s ON s."orderId" = o.id
      WHERE o."deliveryDay" BETWEEN ${from} AND ${to}
      GROUP BY o."deliveryDay"
    ), t AS (
      SELECT day, SUM(COALESCE("drivenKm", "plannedKm")) AS km FROM "Tour"
      WHERE day BETWEEN ${from} AND ${to} GROUP BY day
    )
    SELECT days.day, COALESCE(o.delivered, 0) AS delivered, COALESCE(o.failed, 0) AS failed,
           COALESCE(o.on_time, 0) AS on_time, t.km
    FROM days LEFT JOIN o USING (day) LEFT JOIN t USING (day)
    ORDER BY days.day`;
  return rows.map((r) => {
    const delivered = num(r.delivered);
    return {
      day: r.day.toISOString().slice(0, 10),
      delivered,
      failed: num(r.failed),
      onTimeRate: pct(num(r.on_time), delivered),
      km: r.km === null ? 0 : +num(r.km).toFixed(1),
    };
  });
}

/** Delivery quality per district over a period: where do deliveries fail? */
export async function districts(db: Db, until: string, days = 14) {
  const rows = await db.$queryRaw<{ postcode: string; delivered: bigint; failed: bigint; avg_late: number | null }[]>`
    SELECT o.postcode,
           COUNT(*) FILTER (WHERE o.status = 'DELIVERED') AS delivered,
           COUNT(*) FILTER (WHERE o.status = 'FAILED')    AS failed,
           AVG(GREATEST(s."completedMin" - o."windowEnd", 0)) FILTER (WHERE o.status = 'DELIVERED') AS avg_late
    FROM "Order" o JOIN "Stop" s ON s."orderId" = o.id
    WHERE o."deliveryDay" BETWEEN ${dayDate(addDays(until, -(days - 1)))} AND ${dayDate(until)}
      AND o.status IN ('DELIVERED', 'FAILED')
    GROUP BY o.postcode
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) FILTER (WHERE o.status = 'FAILED')::float / COUNT(*) DESC, o.postcode`;
  return rows.map((r) => {
    const delivered = num(r.delivered);
    const failed = num(r.failed);
    return { postcode: r.postcode, delivered, failed, failRate: pct(failed, delivered + failed), avgLateMin: +num(r.avg_late).toFixed(1) };
  });
}

/** Per-vehicle performance (driver scorecard) over a period. */
export async function vehicles(db: Db, until: string, days = 14) {
  const rows = await db.$queryRaw<{ plate: string; label: string; electric: boolean; tours: bigint; stops: bigint; delivered: bigint; km: number | null; utilization: number | null }[]>`
    WITH per_tour AS (
      SELECT t.id, t."vehicleId", t."loadKg", COALESCE(t."drivenKm", t."plannedKm") AS km,
             COUNT(s.id) AS stops, COUNT(s.id) FILTER (WHERE s.status = 'DELIVERED') AS delivered
      FROM "Tour" t LEFT JOIN "Stop" s ON s."tourId" = t.id
      WHERE t.day BETWEEN ${dayDate(addDays(until, -(days - 1)))} AND ${dayDate(until)}
      GROUP BY t.id
    )
    SELECT v.plate, v.label, v.electric,
           COUNT(pt.id)                          AS tours,
           COALESCE(SUM(pt.stops), 0)            AS stops,
           COALESCE(SUM(pt.delivered), 0)        AS delivered,
           SUM(pt.km)                            AS km,
           AVG(pt."loadKg" / v."capacityKg")     AS utilization
    FROM "Vehicle" v LEFT JOIN per_tour pt ON pt."vehicleId" = v.id
    GROUP BY v.id
    ORDER BY v.plate`;
  return rows.map((r) => ({
    plate: r.plate,
    label: r.label,
    electric: r.electric,
    tours: num(r.tours),
    stops: num(r.stops),
    successRate: pct(num(r.delivered), num(r.stops)),
    km: +num(r.km).toFixed(1),
    utilization: r.utilization === null ? null : +(num(r.utilization) * 100).toFixed(1),
  }));
}
