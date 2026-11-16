/** One GPS fix from a vehicle. Stored in a MongoDB time-series collection in production. */
export interface Fix {
  vehicleId: string;
  tourId: string;
  ts: Date;
  lat: number;
  lng: number;
  speedKmh: number;
  heading: number;
}

/** Port for telemetry storage; implemented by MongoDB (Mongoose) and an in-memory adapter. */
export interface TelemetryStore {
  readonly kind: 'mongodb' | 'memory';
  insert(fix: Fix): Promise<void>;
  /** The breadcrumb trail of a tour, oldest first, thinned to at most `max` points. */
  trail(tourId: string, max?: number): Promise<Fix[]>;
  /** Latest fix per vehicle seen since `since`. */
  latest(since: Date): Promise<Fix[]>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function thin<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  out[out.length - 1] = points[points.length - 1];
  return out;
}

export class MemoryTelemetryStore implements TelemetryStore {
  readonly kind = 'memory' as const;
  private readonly byTour = new Map<string, Fix[]>();
  private readonly last = new Map<string, Fix>();

  async insert(fix: Fix) {
    let list = this.byTour.get(fix.tourId);
    if (!list) this.byTour.set(fix.tourId, (list = []));
    list.push(fix);
    if (list.length > 20_000) list.shift();
    this.last.set(fix.vehicleId, fix);
  }

  async trail(tourId: string, max = 500) {
    return thin(this.byTour.get(tourId) ?? [], max);
  }

  async latest(since: Date) {
    return [...this.last.values()].filter((f) => f.ts >= since);
  }

  async ping() {
    return true;
  }

  async close() {}
}
