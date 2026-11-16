import { Router } from 'express';
import { z } from 'zod';
import { signToken, verifyPassword } from '../auth';
import type { Deps, Guard } from '../deps';
import { HttpError, parse } from '../http/errors';

const loginInput = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) });

/** Small in-memory login throttle: 10 failed attempts per email per 15 minutes. */
const failures = new Map<string, { n: number; until: number }>();

export function authRoutes({ db, config }: Deps, guard: Guard) {
  const r = Router();

  r.post('/login', async (req, res) => {
    const { email, password } = parse(loginInput, req.body);
    const f = failures.get(email);
    if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const user = await db.user.findUnique({ where: { email }, include: { driverOf: { select: { id: true, plate: true } } } });
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      failures.set(email, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw new HttpError(401, 'Email or password is incorrect');
    }
    failures.delete(email);
    const token = signToken({ id: user.id, name: user.name, role: user.role }, config.JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, vehicle: user.driverOf } });
  });

  r.get('/me', guard.driver, async (req, res) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { driverOf: { select: { id: true, plate: true } } } });
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, vehicle: user.driverOf });
  });

  return r;
}
