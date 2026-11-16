import { Router, type RequestHandler } from 'express';

import { safeEqual } from '../auth';
import type { Deps } from '../deps';
import { HttpError } from '../http/errors';
import { primaryDepot } from '../services/planning';
import { createOrder, orderInput } from '../services/orders';

/**
 * Machine-to-machine endpoints for Apache NiFi (webshop CSV → orders, ERP export trigger).
 * Authenticated with the shared INTEGRATION_TOKEN in the x-integration-token header.
 */
export function integrationRoutes({ db, config, tours, notify }: Deps) {
  const r = Router();
  const token: RequestHandler = (req, _res, next) => {
    const t = req.get('x-integration-token');
    if (!t || !safeEqual(t, config.INTEGRATION_TOKEN)) return next(new HttpError(401, 'Invalid integration token'));
    next();
  };

  /**
   * Bulk order intake. Accepts a single order or { orders: [...] } (NiFi MergeRecord output),
   * validates each one independently and reports per-row results, so one bad row does
   * not reject the batch. externalRef makes re-deliveries idempotent.
   */
  r.post('/orders', token, async (req, res) => {
    const rows: unknown[] = Array.isArray(req.body?.orders) ? req.body.orders : [req.body];
    if (rows.length > 1000) throw new HttpError(413, 'At most 1000 orders per request');
    const source = req.get('x-source') === 'erp' ? 'ERP' : 'WEBSHOP';
    const depot = await primaryDepot(db);
    const results = [];
    const days = new Set<string>();
    for (const [i, row] of rows.entries()) {
      const parsed = orderInput.safeParse(normalize(row));
      if (!parsed.success) {
        results.push({ row: i, status: 'rejected', errors: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) });
        continue;
      }
      if (!parsed.data.externalRef) {
        results.push({ row: i, status: 'rejected', errors: ['externalRef: required for integrations'] });
        continue;
      }
      const { order, created } = await createOrder(db, depot.id, parsed.data, source);
      days.add(parsed.data.deliveryDay);
      results.push({ row: i, status: created ? 'created' : 'duplicate', number: order.number, id: order.id });
    }
    days.forEach((day) => notify.orders({ day, reason: 'integration' }));
    const summary = { created: 0, duplicate: 0, rejected: 0 };
    results.forEach((x) => (summary[x.status as keyof typeof summary] += 1));
    await db.auditEvent.create({ data: { actor: `integration:${source.toLowerCase()}`, action: 'orders.import', subject: 'orders', detail: summary } });
    res.status(summary.rejected && !summary.created && !summary.duplicate ? 422 : 200).json({ ...summary, results });
  });

  r.post('/erp/export', token, async (_req, res) => {
    res.json({ exported: await tours.exportPending() });
  });

  return r;
}

/** CSV-derived JSON arrives with strings everywhere and "HH:MM" windows; coerce them. */
function normalize(row: unknown) {
  if (!row || typeof row !== 'object') return row;
  const o: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const k of ['weightKg', 'parcels']) if (typeof o[k] === 'string' && o[k] !== '') o[k] = Number(o[k]);
  for (const k of ['windowStart', 'windowEnd']) {
    const v = o[k];
    if (typeof v === 'string') {
      const m = /^(\d{1,2}):(\d{2})$/.exec(v);
      o[k] = m ? Number(m[1]) * 60 + Number(m[2]) : Number(v);
    }
  }
  if (typeof o.postcode === 'number') o.postcode = String(o.postcode).padStart(5, '0');
  for (const k of Object.keys(o)) if (o[k] === '') delete o[k];
  return o;
}

export const _normalizeForTest = normalize;
