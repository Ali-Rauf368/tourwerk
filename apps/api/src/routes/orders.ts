import { Router } from 'express';
import { z } from 'zod';
import type { Deps, Guard } from '../deps';
import type { OrderStatus, Prisma } from '../generated/prisma/client';
import { HttpError, notFound, parse } from '../http/errors';
import { DAY_RE, dayDate, localDay } from '../services/clock';
import { primaryDepot } from '../services/planning';
import { createOrder, orderInput } from '../services/orders';
import { trackingToken } from '../services/tracking';

const STATUSES = ['NEW', 'PLANNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
const listQuery = z.object({
  day: z.string().regex(DAY_RE).optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function orderRoutes({ db, notify, config }: Deps, guard: Guard) {
  const r = Router();

  r.get('/', guard.dispatcher, async (req, res) => {
    const q = parse(listQuery, req.query);
    const where: Prisma.OrderWhereInput = {
      deliveryDay: dayDate(q.day ?? localDay()),
      ...(q.status ? { status: q.status as OrderStatus } : {}),
      ...(q.q
        ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { customer: { contains: q.q, mode: 'insensitive' } }, { street: { contains: q.q, mode: 'insensitive' } }, { postcode: { startsWith: q.q } }] }
        : {}),
    };
    const [total, items] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
        where,
        orderBy: [{ windowStart: 'asc' }, { number: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { stop: { select: { seq: true, etaMin: true, completedMin: true, tour: { select: { id: true, vehicle: { select: { plate: true } } } } } } },
      }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, items });
  });

  /** Signed link the recipient can open without an account (sent by SMS/e-mail in production). */
  r.get('/:id/tracking-link', guard.dispatcher, async (req, res) => {
    const order = await db.order.findUnique({ where: { id: String(req.params.id) }, select: { number: true } });
    if (!order) throw notFound('Order');
    res.json({ token: trackingToken(config.JWT_SECRET, order.number), path: `/track/${trackingToken(config.JWT_SECRET, order.number)}` });
  });

  r.get('/:id', guard.dispatcher, async (req, res) => {
    const order = await db.order.findUnique({ where: { id: String(req.params.id) }, include: { stop: { include: { tour: { include: { vehicle: true } } } } } });
    if (!order) throw notFound('Order');
    const history = await db.auditEvent.findMany({ where: { subject: order.id }, orderBy: { at: 'asc' } });
    res.json({ ...order, history });
  });

  r.post('/', guard.dispatcher, async (req, res) => {
    const depot = await primaryDepot(db);
    const { order, created } = await createOrder(db, depot.id, parse(orderInput, req.body));
    if (created) {
      await db.auditEvent.create({ data: { actor: req.user!.name, action: 'order.create', subject: order.id } });
      notify.orders({ day: order.deliveryDay.toISOString().slice(0, 10), reason: 'order.create' });
    }
    res.status(created ? 201 : 200).json(order);
  });

  r.post('/:id/cancel', guard.dispatcher, async (req, res) => {
    const id = String(req.params.id);
    const done = await db.order.updateMany({ where: { id, status: 'NEW' }, data: { status: 'CANCELLED' } });
    if (!done.count) throw new HttpError(409, 'Only unplanned orders can be cancelled');
    await db.auditEvent.create({ data: { actor: req.user!.name, action: 'order.cancel', subject: id } });
    const order = await db.order.findUniqueOrThrow({ where: { id } });
    notify.orders({ day: order.deliveryDay.toISOString().slice(0, 10), reason: 'order.cancel' });
    res.json(order);
  });

  return r;
}
