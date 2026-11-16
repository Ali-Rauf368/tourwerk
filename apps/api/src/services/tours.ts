import type { Db } from '../db/prisma';
import type { ErpExporter } from '../erp/exporter';
import type { StopStatus } from '../generated/prisma/client';
import { HttpError } from '../http/errors';
import { dayString, localMinute } from './clock';
import type { Notify } from './notify';

export const FAIL_REASONS = ['recipient_absent', 'address_not_found', 'refused', 'damaged'] as const;

/** Tour execution: stop events from drivers or the simulator, completion and ERP export. */
export class TourService {
  constructor(
    private readonly db: Db,
    private readonly erp: ErpExporter,
    private readonly notify: Notify,
    private readonly log: (m: string) => void = () => {},
  ) {}

  async start(tourId: string, actor: string) {
    const res = await this.db.tour.updateMany({ where: { id: tourId, status: 'PLANNED' }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    if (!res.count) throw new HttpError(409, 'Only planned tours can be started');
    const tour = await this.db.tour.findUniqueOrThrow({ where: { id: tourId }, include: { stops: { select: { orderId: true } } } });
    await this.db.order.updateMany({ where: { id: { in: tour.stops.map((s) => s.orderId) } }, data: { status: 'OUT_FOR_DELIVERY' } });
    await this.db.auditEvent.create({ data: { actor, action: 'tour.start', subject: tourId } });
    this.notify.tour({ id: tour.id, status: tour.status, vehicleId: tour.vehicleId });
    this.notify.orders({ day: dayString(tour.day), reason: 'tour.start' });
    return tour;
  }

  /**
   * Record what happened at a stop. Transitions are monotonic (PENDING → ARRIVED →
   * DELIVERED | FAILED); repeating a final event is a no-op, so retries are safe.
   */
  async stopEvent(stopId: string, event: StopStatus, opts: { reason?: string; clockMin?: number; actor: string }) {
    const stop = await this.db.stop.findUnique({ where: { id: stopId }, include: { tour: true } });
    if (!stop) throw new HttpError(404, 'Stop not found');
    if (stop.tour.status !== 'IN_PROGRESS') throw new HttpError(409, 'The tour has not been started');
    if (stop.status === 'DELIVERED' || stop.status === 'FAILED') {
      if (stop.status === event) return stop;
      throw new HttpError(409, `Stop is already ${stop.status.toLowerCase()}`);
    }
    if (event === 'PENDING') throw new HttpError(400, 'Invalid event');
    if (event === 'FAILED' && !opts.reason) throw new HttpError(400, 'A reason is required for failed deliveries');

    const now = new Date();
    const clockMin = opts.clockMin ?? localMinute(now);
    const final = event === 'DELIVERED' || event === 'FAILED';
    const updated = await this.db.$transaction(async (tx) => {
      const s = await tx.stop.update({
        where: { id: stopId },
        data: {
          status: event,
          arrivedAt: stop.arrivedAt ?? now,
          ...(final ? { completedAt: now, completedMin: clockMin } : {}),
        },
      });
      if (final) {
        await tx.order.update({
          where: { id: stop.orderId },
          data: { status: event, failReason: event === 'FAILED' ? opts.reason : null, deliveredAt: event === 'DELIVERED' ? now : null },
        });
        await tx.auditEvent.create({ data: { actor: opts.actor, action: `stop.${event.toLowerCase()}`, subject: stop.orderId, detail: opts.reason ? { reason: opts.reason } : undefined } });
      }
      return s;
    });
    this.notify.stop({ tourId: stop.tourId, vehicleId: stop.tour.vehicleId, stopId, orderId: stop.orderId, status: event, completedMin: updated.completedMin, failReason: opts.reason ?? null });
    if (final) await this.completeIfDone(stop.tourId);
    return updated;
  }

  /** Close the tour once every stop has a final status, then export to the ERP. */
  async completeIfDone(tourId: string, drivenKm?: number) {
    const open = await this.db.stop.count({ where: { tourId, status: { in: ['PENDING', 'ARRIVED'] } } });
    if (open) {
      if (drivenKm !== undefined) await this.db.tour.update({ where: { id: tourId }, data: { drivenKm } });
      return false;
    }
    const res = await this.db.tour.updateMany({ where: { id: tourId, status: 'IN_PROGRESS' }, data: { status: 'COMPLETED', completedAt: new Date(), ...(drivenKm !== undefined ? { drivenKm } : {}) } });
    if (drivenKm !== undefined && !res.count) await this.db.tour.update({ where: { id: tourId }, data: { drivenKm } });
    if (res.count) {
      const tour = await this.db.tour.findUniqueOrThrow({ where: { id: tourId } });
      this.notify.tour({ id: tour.id, status: tour.status, vehicleId: tour.vehicleId, drivenKm: tour.drivenKm });
      this.notify.orders({ day: dayString(tour.day), reason: 'tour.completed' });
      await this.exportPending().catch((e) => this.log(`erp export failed (will retry): ${e}`));
    }
    return res.count > 0;
  }

  /** Push finished, not yet exported orders to the ERP. Idempotent on both sides. */
  async exportPending(limit = 500) {
    const orders = await this.db.order.findMany({
      where: { status: { in: ['DELIVERED', 'FAILED'] }, exportedAt: null },
      take: limit,
      include: { stop: { include: { tour: { include: { vehicle: { select: { plate: true } } } } } } },
    });
    if (!orders.length) return 0;
    await this.erp.export(
      orders.map((o) => ({
        orderNumber: o.number,
        externalRef: o.externalRef,
        customer: o.customer,
        postcode: o.postcode,
        status: o.status as 'DELIVERED' | 'FAILED',
        failReason: o.failReason,
        deliveredAt: o.deliveredAt ?? o.stop?.completedAt ?? new Date(),
        weightKg: o.weightKg,
        parcels: o.parcels,
        vehiclePlate: o.stop?.tour.vehicle.plate ?? '',
      })),
    );
    await this.db.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { exportedAt: new Date() } });
    return orders.length;
  }
}
