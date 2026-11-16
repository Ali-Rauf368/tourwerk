import { Router } from 'express';
import { z } from 'zod';
import { hashPassword } from '../auth';
import type { Deps, Guard } from '../deps';
import { HttpError, notFound, parse } from '../http/errors';
import { primaryDepot } from '../services/planning';

const vehicleInput = z.object({
  plate: z.string().trim().toUpperCase().regex(/^[A-ZÄÖÜ]{1,3}-[A-Z]{1,2} \d{1,4}E?$/, 'German plate, e.g. HH-TW 101'),
  label: z.string().trim().min(2).max(60),
  capacityKg: z.number().positive().max(3500),
  electric: z.boolean().default(false),
  driverId: z.string().uuid().nullable().optional(),
});

const driverInput = z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().toLowerCase(), password: z.string().min(10).max(200) });

export function fleetRoutes({ db, telemetry }: Deps, guard: Guard) {
  const r = Router();

  r.get('/depot', guard.driver, async (_req, res) => res.json(await primaryDepot(db)));

  r.get('/vehicles', guard.dispatcher, async (_req, res) => {
    res.json(await db.vehicle.findMany({ orderBy: { plate: 'asc' }, include: { driver: { select: { id: true, name: true, email: true } } } }));
  });

  r.post('/vehicles', guard.admin, async (req, res) => {
    const input = parse(vehicleInput, req.body);
    const depot = await primaryDepot(db);
    try {
      res.status(201).json(await db.vehicle.create({ data: { ...input, depotId: depot.id } }));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'Plate or driver is already in use');
      throw e;
    }
  });

  r.patch('/vehicles/:id', guard.admin, async (req, res) => {
    const input = parse(vehicleInput.partial().extend({ active: z.boolean().optional() }), req.body);
    const exists = await db.vehicle.findUnique({ where: { id: String(req.params.id) } });
    if (!exists) throw notFound('Vehicle');
    try {
      res.json(await db.vehicle.update({ where: { id: exists.id }, data: input }));
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'Plate or driver is already in use');
      throw e;
    }
  });

  r.get('/drivers', guard.dispatcher, async (_req, res) => {
    res.json(await db.user.findMany({ where: { role: 'DRIVER' }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, active: true, driverOf: { select: { id: true, plate: true } } } }));
  });

  r.post('/drivers', guard.admin, async (req, res) => {
    const input = parse(driverInput, req.body);
    try {
      const u = await db.user.create({ data: { name: input.name, email: input.email, role: 'DRIVER', passwordHash: hashPassword(input.password) } });
      res.status(201).json({ id: u.id, name: u.name, email: u.email });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'Email is already registered');
      throw e;
    }
  });

  /** Latest known position of every vehicle (last 12 hours). */
  r.get('/positions', guard.dispatcher, async (_req, res) => {
    res.json(await telemetry.latest(new Date(Date.now() - 12 * 3600_000)));
  });

  return r;
}
