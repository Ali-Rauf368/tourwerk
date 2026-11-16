import type { Db } from '../db/prisma';
import { haversineKm } from './geo';
import type { Notify } from './notify';
import { AVERAGE_SPEED_KMH } from './planning';

export type Risk = 'ok' | 'tight' | 'late';
/** Minutes of slack below which a stop counts as "tight". */
export const TIGHT_SLACK_MIN = 15;

export interface EtaStop {
  id: string;
  seq: number;
  etaMin: number;
  status: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED';
  completedMin: number | null;
  lat: number;
  lng: number;
  serviceMin: number;
  windowStart: number;
  windowEnd: number;
  number: string;
  customer: string;
}

export interface TourSnapshot {
  tourId: string;
  vehicleId: string;
  depot: { lat: number; lng: number; shiftStart: number };
  stops: EtaStop[];
}

export interface LivePosition {
  lat: number;
  lng: number;
  clockMin: number;
}

export interface Prediction {
  tourId: string;
  vehicleId: string;
  clockMin: number;
  /** Observed driving pace vs. plan (1.2 = 20 % slower than planned). */
  pace: number;
  /** How far behind plan the next stop is predicted to be, in minutes. */
  delayMin: number;
  predictedReturn: number;
  late: number;
  tight: number;
  stops: { id: string; seq: number; number: string; customer: string; plannedMin: number; predictedMin: number; windowEnd: number; slackMin: number; risk: Risk }[];
}

const final = (s: EtaStop) => s.status === 'DELIVERED' || s.status === 'FAILED';

/**
 * Re-forecast the rest of a running tour. The pace factor is learned from the stops
 * already completed (actual vs. planned elapsed time), shrunk towards 1 while only a few
 * stops are known, and applied to the remaining legs from the van's current position.
 */
export function predictTour(snap: TourSnapshot, pos: LivePosition | null, nowMin?: number, speedKmh = AVERAGE_SPEED_KMH): Prediction {
  const stops = [...snap.stops].sort((a, b) => a.seq - b.seq);
  const done = stops.filter((s) => final(s) && s.completedMin !== null);
  const last = done.at(-1);

  let pace = 1;
  if (last) {
    const planned = last.etaMin + last.serviceMin - snap.depot.shiftStart;
    const actual = last.completedMin! - snap.depot.shiftStart;
    if (planned >= 20) {
      const raw = Math.min(1.6, Math.max(0.85, actual / planned));
      pace = 1 + (raw - 1) * Math.min(1, done.length / 5);
    }
  }

  let here: { lat: number; lng: number } = pos ?? (last ? { lat: last.lat, lng: last.lng } : snap.depot);
  let t = pos?.clockMin ?? Math.max(last?.completedMin ?? snap.depot.shiftStart, nowMin ?? 0);
  const clockMin = t;
  const legMin = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.ceil(((haversineKm(a, b) * 1.3) / speedKmh) * 60 * pace);

  const out: Prediction['stops'] = [];
  for (const s of stops) {
    if (final(s)) continue;
    if (s.status !== 'ARRIVED') t = Math.max(t + legMin(here, s), s.windowStart);
    const slackMin = s.windowEnd - t;
    out.push({ id: s.id, seq: s.seq, number: s.number, customer: s.customer, plannedMin: s.etaMin, predictedMin: t, windowEnd: s.windowEnd, slackMin, risk: slackMin < 0 ? 'late' : slackMin < TIGHT_SLACK_MIN ? 'tight' : 'ok' });
    t += s.serviceMin;
    here = s;
  }
  const predictedReturn = t + legMin(here, snap.depot);
  return {
    tourId: snap.tourId,
    vehicleId: snap.vehicleId,
    clockMin,
    pace: +pace.toFixed(3),
    delayMin: out.length ? out[0].predictedMin - out[0].plannedMin : 0,
    predictedReturn,
    late: out.filter((s) => s.risk === 'late').length,
    tight: out.filter((s) => s.risk === 'tight').length,
    stops: out,
  };
}

/**
 * Keeps a snapshot of every running tour in memory and re-forecasts it whenever a
 * position or stop event passes through. Used as a Notify decorator, so the simulator
 * and the driver API need no changes; forecasts go out as "tour:eta" at most once
 * per `throttleMs` per tour (stop events always publish immediately).
 */
export class EtaService {
  private readonly snapshots = new Map<string, Promise<TourSnapshot | null>>();
  private readonly positions = new Map<string, LivePosition>();
  private readonly lastSent = new Map<string, number>();
  private readonly latest = new Map<string, Prediction>();

  constructor(
    private readonly db: Db,
    private readonly throttleMs = 1000,
  ) {}

  /** Wrap a notifier: events pass through unchanged, forecasts are published alongside. */
  decorate(inner: Notify): Notify {
    return {
      ...inner,
      position: (p) => {
        inner.position(p);
        this.positions.set(p.tourId, { lat: p.lat, lng: p.lng, clockMin: p.clockMin });
        const now = Date.now();
        if (now - (this.lastSent.get(p.tourId) ?? 0) < this.throttleMs) return;
        this.lastSent.set(p.tourId, now);
        void this.publish(p.tourId, inner);
      },
      stop: (s) => {
        inner.stop(s);
        void this.applyStop(s.tourId, s.stopId, s.status as EtaStop['status'], s.completedMin).then(() => this.publish(s.tourId, inner));
      },
      tour: (t) => {
        inner.tour(t);
        if (t.status === 'COMPLETED') this.forget(t.id);
      },
    };
  }

  /** Current forecast for a tour (loads it if it has not been seen yet). */
  async predict(tourId: string, nowMin?: number) {
    const snap = await this.snapshot(tourId);
    if (!snap) return null;
    const p = predictTour(snap, this.positions.get(tourId) ?? null, nowMin);
    this.latest.set(tourId, p);
    return p;
  }

  forget(tourId: string) {
    this.snapshots.delete(tourId);
    this.positions.delete(tourId);
    this.lastSent.delete(tourId);
    this.latest.delete(tourId);
  }

  private snapshot(tourId: string) {
    let snap = this.snapshots.get(tourId);
    if (!snap) {
      snap = this.load(tourId);
      this.snapshots.set(tourId, snap);
      snap.catch(() => this.snapshots.delete(tourId));
    }
    return snap;
  }

  private async load(tourId: string): Promise<TourSnapshot | null> {
    const tour = await this.db.tour.findUnique({ where: { id: tourId }, include: { depot: true, stops: { include: { order: true } } } });
    if (!tour) return null;
    return {
      tourId,
      vehicleId: tour.vehicleId,
      depot: { lat: tour.depot.lat, lng: tour.depot.lng, shiftStart: tour.depot.shiftStart },
      stops: tour.stops.map((s) => ({
        id: s.id,
        seq: s.seq,
        etaMin: s.etaMin,
        status: s.status,
        completedMin: s.completedMin,
        lat: s.order.lat,
        lng: s.order.lng,
        serviceMin: s.order.serviceMin,
        windowStart: s.order.windowStart,
        windowEnd: s.order.windowEnd,
        number: s.order.number,
        customer: s.order.customer,
      })),
    };
  }

  private async applyStop(tourId: string, stopId: string, status: EtaStop['status'], completedMin: number | null) {
    const snap = await this.snapshot(tourId);
    const stop = snap?.stops.find((s) => s.id === stopId);
    if (stop) {
      stop.status = status;
      stop.completedMin = completedMin;
    }
  }

  private async publish(tourId: string, inner: Notify) {
    try {
      const p = await this.predict(tourId);
      if (p) inner.eta(p);
    } catch {
      // A forecast is best effort; the next event retries.
    }
  }
}
