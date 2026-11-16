import type { Prediction } from './eta';

/** Real-time fan-out (Socket.IO in production, a no-op or spy in tests). */
export interface Notify {
  /** A vehicle position from the simulator (or a driver app). */
  position(p: { vehicleId: string; tourId: string; lat: number; lng: number; speedKmh: number; heading: number; nextSeq: number; clockMin: number }): void;
  stop(s: { tourId: string; vehicleId: string; stopId: string; orderId: string; status: string; completedMin: number | null; failReason?: string | null }): void;
  tour(t: { id: string; status: string; vehicleId: string; drivenKm?: number | null }): void;
  orders(change: { day: string; reason: string }): void;
  /** A fresh arrival forecast for a running tour (see services/eta.ts). */
  eta(p: Prediction): void;
}

export const silentNotify: Notify = { position() {}, stop() {}, tour() {}, orders() {}, eta() {} };
