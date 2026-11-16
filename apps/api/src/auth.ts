import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from './generated/prisma/client';
import { HttpError } from './http/errors';

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Integration tokens are stored as SHA-256 hashes only. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

export function signToken(user: AuthUser, secret: string) {
  return jwt.sign({ name: user.name, role: user.role }, secret, { subject: user.id, expiresIn: '8h', algorithm: 'HS256' });
}

export function verifyToken(token: string, secret: string): AuthUser | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return { id: String(p.sub), name: String(p.name), role: p.role as Role };
  } catch {
    return null;
  }
}

/** DRIVER < DISPATCHER < ADMIN. Drivers only see their own tour (checked in the routes). */
const LEVEL: Record<Role, number> = { DRIVER: 0, DISPATCHER: 1, ADMIN: 2 };

/** Require a signed-in user with at least the given role. */
export const requireRole =
  (secret: string, min: Role = 'DRIVER', isActive: (id: string) => Promise<boolean>): RequestHandler =>
  async (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const user = header.startsWith('Bearer ') ? verifyToken(header.slice(7), secret) : null;
    if (!user || !(await isActive(user.id))) return next(new HttpError(401, 'Please sign in'));
    if (LEVEL[user.role] < LEVEL[min]) return next(new HttpError(403, 'Your role does not allow this'));
    req.user = user;
    next();
  };
