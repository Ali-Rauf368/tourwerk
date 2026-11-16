import { z } from 'zod';
import type { Db } from '../db/prisma';
import type { OrderSource, Prisma } from '../generated/prisma/client';
import { HttpError } from '../http/errors';
import { DAY_RE, dayDate } from './clock';
import { geocode, POSTCODES } from './geo';

const minute = z.number().int().min(0).max(24 * 60);

export const orderInput = z
  .object({
    customer: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(40).optional(),
    street: z.string().trim().min(3).max(160),
    postcode: z.string().regex(/^\d{5}$/, 'Five-digit postcode'),
    weightKg: z.number().positive().max(1000),
    parcels: z.number().int().min(1).max(99).default(1),
    windowStart: minute.default(8 * 60),
    windowEnd: minute.default(18 * 60),
    deliveryDay: z.string().regex(DAY_RE, 'Use YYYY-MM-DD'),
    note: z.string().trim().max(500).optional(),
    externalRef: z.string().trim().min(1).max(64).optional(),
  })
  .refine((o) => o.windowEnd - o.windowStart >= 30, { message: 'The delivery window must be at least 30 minutes', path: ['windowEnd'] })
  .refine((o) => o.postcode in POSTCODES, { message: 'Postcode is outside the service area', path: ['postcode'] });

export type OrderInput = z.infer<typeof orderInput>;

async function nextNumber(tx: Prisma.TransactionClient, year: string) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
  return `TW-${year}-${String(n).padStart(5, '0')}`;
}

/**
 * Create an order. With an externalRef the call is idempotent: a repeat delivery of the
 * same webshop/ERP order returns the existing row instead of creating a duplicate.
 */
export async function createOrder(db: Db, depotId: string, input: OrderInput, source: OrderSource = 'MANUAL') {
  if (input.externalRef) {
    const existing = await db.order.findUnique({ where: { externalRef: input.externalRef } });
    if (existing) return { order: existing, created: false };
  }
  const point = geocode(input.street, input.postcode);
  if (!point) throw new HttpError(400, 'Postcode is outside the service area');
  try {
    const order = await db.$transaction(async (tx) =>
      tx.order.create({
        data: {
          ...input,
          number: await nextNumber(tx, input.deliveryDay.slice(0, 4)),
          deliveryDay: dayDate(input.deliveryDay),
          serviceMin: Math.min(15, 3 + input.parcels),
          source,
          depotId,
          ...point,
        },
      }),
    );
    return { order, created: true };
  } catch (e) {
    // Two concurrent deliveries of the same externalRef: the loser reads the winner's row.
    if ((e as { code?: string }).code === 'P2002' && input.externalRef) {
      const order = await db.order.findUniqueOrThrow({ where: { externalRef: input.externalRef } });
      return { order, created: false };
    }
    throw e;
  }
}
