import { Router } from 'express';
import { z } from 'zod';
import type { Deps, Guard } from '../deps';
import { parse } from '../http/errors';
import { daySummary, districts, trend, vehicles } from '../services/analytics';
import { DAY_RE, localDay } from '../services/clock';

const q = z.object({ day: z.string().regex(DAY_RE).optional(), days: z.coerce.number().int().min(1).max(90).default(14) });

export function analyticsRoutes({ db }: Deps, guard: Guard) {
  const r = Router();
  r.get('/summary', guard.dispatcher, async (req, res) => res.json(await daySummary(db, parse(q, req.query).day ?? localDay())));
  r.get('/trend', guard.dispatcher, async (req, res) => {
    const { day, days } = parse(q, req.query);
    res.json(await trend(db, day ?? localDay(), days));
  });
  r.get('/districts', guard.dispatcher, async (req, res) => {
    const { day, days } = parse(q, req.query);
    res.json(await districts(db, day ?? localDay(), days));
  });
  r.get('/vehicles', guard.dispatcher, async (req, res) => {
    const { day, days } = parse(q, req.query);
    res.json(await vehicles(db, day ?? localDay(), days));
  });
  /** CSV export of the trend for spreadsheets / BI tools. */
  r.get('/trend.csv', guard.dispatcher, async (req, res) => {
    const { day, days } = parse(q, req.query);
    const rows = await trend(db, day ?? localDay(), days);
    res.type('text/csv').attachment('tourwerk-trend.csv');
    res.send(['day,delivered,failed,on_time_rate,km', ...rows.map((r) => `${r.day},${r.delivered},${r.failed},${r.onTimeRate ?? ''},${r.km}`)].join('\n'));
  });
  return r;
}
