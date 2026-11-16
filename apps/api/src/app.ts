import express from 'express';
import helmet from 'helmet';
import { requireRole } from './auth';
import type { Deps, Guard } from './deps';
import { errorHandler, HttpError } from './http/errors';
import { analyticsRoutes } from './routes/analytics';
import { authRoutes } from './routes/auth';
import { fleetRoutes } from './routes/fleet';
import { integrationRoutes } from './routes/integration';
import { orderRoutes } from './routes/orders';
import { planningRoutes } from './routes/planning';
import { tourRoutes } from './routes/tours';
import { trackingRoutes } from './routes/tracking';

export function createApp(deps: Deps) {
  const { db, config, optimizer, telemetry, erp, sim } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));

  // Cache "is this user still active" briefly so auth does not hit the DB on every request.
  const activeCache = new Map<string, { ok: boolean; at: number }>();
  const isActive = async (id: string) => {
    const hit = activeCache.get(id);
    if (hit && Date.now() - hit.at < 10_000) return hit.ok;
    const ok = !!(await db.user.findFirst({ where: { id, active: true }, select: { id: true } }));
    activeCache.set(id, { ok, at: Date.now() });
    return ok;
  };
  const guard: Guard = {
    driver: requireRole(config.JWT_SECRET, 'DRIVER', isActive),
    dispatcher: requireRole(config.JWT_SECRET, 'DISPATCHER', isActive),
    admin: requireRole(config.JWT_SECRET, 'ADMIN', isActive),
  };

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    const [pg, tel, erpOk] = await Promise.all([db.$queryRaw`SELECT 1`.then(() => true, () => false), telemetry.ping(), erp.ping()]);
    res.status(pg ? 200 : 503).json({
      status: pg && tel && erpOk ? 'ok' : 'degraded',
      postgres: pg,
      telemetry: { kind: telemetry.kind, ok: tel },
      erp: { kind: erp.kind, ok: erpOk },
      optimizer: optimizer.name,
      simulator: sim.available,
    });
  });
  api.use('/auth', authRoutes(deps, guard));
  api.use('/orders', orderRoutes(deps, guard));
  api.use('/planning', planningRoutes(deps, guard));
  api.use('/tours', tourRoutes(deps, guard));
  api.use('/fleet', fleetRoutes(deps, guard));
  api.use('/analytics', analyticsRoutes(deps, guard));
  api.use('/integration', integrationRoutes(deps));
  api.use('/track', trackingRoutes(deps));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/api', api);
  app.use(errorHandler);
  return app;
}
