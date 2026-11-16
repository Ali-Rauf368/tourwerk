import { Router } from 'express';
import { z } from 'zod';
import type { Deps, Guard } from '../deps';
import { parse } from '../http/errors';
import { DAY_RE } from '../services/clock';
import { commitInput, commitPlan, fleetScenarios, proposePlan } from '../services/planning';

const dayInput = z.object({ day: z.string().regex(DAY_RE, 'Use YYYY-MM-DD') });

export function planningRoutes({ db, optimizer, notify, config }: Deps, guard: Guard) {
  const r = Router();

  /** Run the optimizer and return a proposal; nothing is saved. */
  r.post('/optimize', guard.dispatcher, async (req, res) => {
    const { day } = parse(dayInput, req.body);
    res.json(await proposePlan(db, optimizer, day, config.OPTIMIZER_SEARCH_MS));
  });

  /** Fleet-size what-if over the day's open orders (read-only). */
  r.post('/scenarios', guard.dispatcher, async (req, res) => {
    const { day } = parse(dayInput, req.body);
    res.json(await fleetScenarios(db, optimizer, day, Math.min(config.OPTIMIZER_SEARCH_MS, 600)));
  });

  r.post('/commit', guard.dispatcher, async (req, res) => {
    const input = parse(commitInput.extend({ day: z.string().regex(DAY_RE) }), req.body);
    const tours = await commitPlan(db, input, req.user!.name);
    notify.orders({ day: input.day, reason: 'plan.commit' });
    res.status(201).json({ tours: tours.map((t) => t.id) });
  });

  return r;
}
