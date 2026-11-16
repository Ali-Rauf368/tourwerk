import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/prisma';
import { notFound } from '../http/errors';
import type { EtaService } from './eta';
import type { FleetSimulator } from '../sim/fleet';
import type { TelemetryStore } from '../telemetry/store';
import { localMinute } from './clock';

/** The van's position is only shared once the recipient is this close in the stop order. */
export const SHOW_VAN_WITHIN_STOPS = 3;
/** The promised arrival window is the forecast ± this many minutes, rounded to 5. */
export const ETA_SPREAD_MIN = 15;

const sign = (secret: string, number: string) => createHmac('sha256', secret).update(`track:${number}`).digest('base64url').slice(0, 22);

/** A tracking token is the order number plus an HMAC, so links cannot be guessed or enumerated. */
export function trackingToken(secret: string, number: string) {
  return `${number}.${sign(secret, number)}`;
}

export function verifyToken(secret: string, token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const number = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, number));
  return given.length === expected.length && timingSafeEqual(given, expected) ? number : null;
}

const round5 = (m: number) => Math.round(m / 5) * 5;

/**
 * What a recipient may see about their delivery. Deliberately narrow: no other customers,
 * no driver surname, and the van's position only when it is nearly there.
 */
export async function trackingView(db: Db, eta: EtaService, telemetry: TelemetryStore, sim: FleetSimulator, number: string) {
  const order = await db.order.findUnique({
    where: { number },
    include: { depot: true, stop: { include: { tour: { include: { vehicle: { include: { driver: { select: { name: true } } } } } } } } },
  });
  if (!order) throw notFound('Delivery');
  const tour = order.stop?.tour;
  const base = {
    number: order.number,
    status: order.status,
    street: order.street,
    postcode: order.postcode,
    city: order.city,
    parcels: order.parcels,
    deliveryDay: order.deliveryDay.toISOString().slice(0, 10),
    window: { start: order.windowStart, end: order.windowEnd },
    depot: { lat: order.depot.lat, lng: order.depot.lng },
    destination: { lat: order.lat, lng: order.lng },
    completedMin: order.stop?.completedMin ?? null,
    failReason: order.failReason,
    driver: tour?.vehicle.driver?.name.split(' ')[0] ?? null,
    vehicle: tour ? { plate: tour.vehicle.plate, electric: tour.vehicle.electric } : null,
    plannedEta: order.stop ? { start: round5(order.stop.etaMin - ETA_SPREAD_MIN), end: round5(order.stop.etaMin + ETA_SPREAD_MIN) } : null,
    stopsBefore: null as number | null,
    eta: null as { start: number; end: number; risk: string } | null,
    van: null as { lat: number; lng: number; heading: number } | null,
  };
  if (!tour || tour.status !== 'IN_PROGRESS' || order.status !== 'OUT_FOR_DELIVERY') return base;

  const prediction = await eta.predict(tour.id, sim.isRunning(tour.id) ? undefined : localMinute());
  const idx = prediction?.stops.findIndex((s) => s.id === order.stop!.id) ?? -1;
  if (prediction && idx >= 0) {
    const mine = prediction.stops[idx];
    base.stopsBefore = idx;
    base.eta = { start: round5(mine.predictedMin - ETA_SPREAD_MIN), end: round5(mine.predictedMin + ETA_SPREAD_MIN), risk: mine.risk };
    if (idx < SHOW_VAN_WITHIN_STOPS) {
      const fix = (await telemetry.latest(new Date(Date.now() - 10 * 60_000))).find((f) => f.tourId === tour.id);
      if (fix) base.van = { lat: fix.lat, lng: fix.lng, heading: fix.heading };
    }
  }
  return base;
}
