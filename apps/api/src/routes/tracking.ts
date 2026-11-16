import { Router } from 'express';
import type { Deps } from '../deps';
import { HttpError } from '../http/errors';
import { trackingView, verifyToken } from '../services/tracking';

/** Public, unauthenticated delivery tracking for recipients. Throttled per client IP. */
export function trackingRoutes({ db, eta, telemetry, sim, config }: Deps) {
  const r = Router();
  const hits = new Map<string, { n: number; reset: number }>();
  const LIMIT = 120; // requests per minute per IP: generous for a page polling every 10 s

  r.get('/:token', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > LIMIT) throw new HttpError(429, 'Too many requests');
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);

    const number = verifyToken(config.JWT_SECRET, String(req.params.token));
    if (!number) throw new HttpError(404, 'Unknown tracking link');
    res.set('Cache-Control', 'no-store');
    res.json(await trackingView(db, eta, telemetry, sim, number));
  });
  return r;
}
