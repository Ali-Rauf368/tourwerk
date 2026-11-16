import request from 'supertest';
import { addDays, localDay } from '../src/services/clock';
import { ADMIN, DISPO, DRIVER1, DRIVER2, planDay, setup, type Ctx } from './helpers';

const today = localDay();
const tomorrow = addDays(today, 1);
let ctx: Ctx;

beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const newOrder = (over: Record<string, unknown> = {}) => ({
  customer: 'Kaffeerösterei Elbe',
  street: 'Osterstraße 12',
  postcode: '20259',
  weightKg: 12.5,
  parcels: 2,
  windowStart: 540,
  windowEnd: 720,
  deliveryDay: tomorrow,
  ...over,
});

describe('authentication and roles', () => {
  test('wrong password is refused without revealing which part was wrong', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: DISPO, password: 'nope' }).expect(401);
    expect(res.body.error).toBe('Email or password is incorrect');
  });

  test('requests without a token get 401', async () => {
    await request(ctx.app).get('/api/orders').expect(401);
  });

  test('drivers cannot use dispatcher endpoints', async () => {
    const h = await ctx.login(DRIVER1);
    await request(ctx.app).get('/api/orders').set(h).expect(403);
    await request(ctx.app).post('/api/planning/optimize').set(h).send({ day: today }).expect(403);
  });

  test('dispatchers cannot manage the fleet; admins can', async () => {
    const body = { plate: 'HH-TW 999', label: 'Test van', capacityKg: 500 };
    await request(ctx.app).post('/api/fleet/vehicles').set(await ctx.login(DISPO)).send(body).expect(403);
    await request(ctx.app).post('/api/fleet/vehicles').set(await ctx.login(ADMIN)).send({ ...body, active: undefined }).expect(201);
    await request(ctx.app).post('/api/fleet/vehicles').set(await ctx.login(ADMIN)).send(body).expect(409);
  });
});

describe('orders', () => {
  test('creates an order with a sequential number and geocoded position', async () => {
    const res = await request(ctx.app).post('/api/orders').set(await ctx.login(DISPO)).send(newOrder()).expect(201);
    expect(res.body.number).toMatch(/^TW-\d{4}-\d{5}$/);
    expect(res.body.lat).toBeCloseTo(53.5745, 1);
    expect(res.body.status).toBe('NEW');
  });

  test('validates postcode area and window length with field details', async () => {
    const res = await request(ctx.app).post('/api/orders').set(await ctx.login(DISPO)).send(newOrder({ postcode: '80331', windowEnd: 550 })).expect(400);
    const paths = res.body.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['windowEnd']));
  });

  test('externalRef makes creation idempotent', async () => {
    const h = await ctx.login(DISPO);
    const a = await request(ctx.app).post('/api/orders').set(h).send(newOrder({ externalRef: 'SHOP-IDEMP-1' })).expect(201);
    const b = await request(ctx.app).post('/api/orders').set(h).send(newOrder({ externalRef: 'SHOP-IDEMP-1' })).expect(200);
    expect(b.body.id).toBe(a.body.id);
  });

  test('search and pagination', async () => {
    const res = await request(ctx.app).get(`/api/orders?day=${tomorrow}&q=Kaffeerösterei Elbe&pageSize=1`).set(await ctx.login(DISPO)).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('planning', () => {
  test('fleet-size what-if solves every fleet size and recommends the cheapest full plan', async () => {
    const body = (await request(ctx.app).post('/api/planning/scenarios').set(await ctx.login(DISPO)).send({ day: tomorrow }).expect(200)).body;
    expect(body.orders).toBeGreaterThan(20);
    expect(body.scenarios.length).toBeGreaterThanOrEqual(6);
    expect(body.scenarios.map((s: { vans: number }) => s.vans)).toEqual(body.scenarios.map((_: unknown, i: number) => i + 1));
    const rec = body.scenarios.find((s: { vans: number }) => s.vans === body.recommended);
    expect(rec.unassigned).toBe(0);
    for (const s of body.scenarios) {
      expect(s.vansUsed).toBeLessThanOrEqual(s.vans);
      if (s.unassigned === 0) expect(rec.costEur).toBeLessThanOrEqual(s.costEur);
    }
    // Nothing was planned: the what-if is read-only.
    const summary = (await request(ctx.app).get(`/api/analytics/summary?day=${tomorrow}`).set(await ctx.login(DISPO)).expect(200)).body;
    expect(summary.orders.unplanned).toBe(summary.orders.total);
  });

  test('optimizes today: capacity and windows hold, far shorter than single trips', async () => {
    const { plan } = await planDay(ctx, today);
    expect(plan.engine).toBe('native');
    expect(plan.routes.length).toBeGreaterThan(0);
    expect(plan.unassigned).toHaveLength(0);
    expect(plan.totalKm).toBeLessThan(plan.baselineKm / 3);
    for (const r of plan.routes) {
      expect(r.loadKg).toBeLessThanOrEqual(r.vehicle.capacityKg);
      for (const s of r.stops) {
        expect(s.etaMin).toBeGreaterThanOrEqual(s.windowStart);
        expect(s.etaMin).toBeLessThanOrEqual(s.windowEnd);
      }
    }
  });

  test('rejects a plan that would overload a vehicle', async () => {
    const h = await ctx.login(DISPO);
    const heavy = (await request(ctx.app).post('/api/orders').set(h).send(newOrder({ customer: 'Tischlerei Petersen', weightKg: 700 })).expect(201)).body;
    const { body } = await planDay(ctx, tomorrow);
    const route = body.routes.find((r: { stops: { orderId: string }[] }) => r.stops.some((s) => s.orderId === heavy.id));
    const vans = (await request(ctx.app).get('/api/fleet/vehicles').set(h).expect(200)).body;
    const small = vans.find((v: { plate: string }) => v.plate === 'HH-TW 202E'); // 650 kg
    const res = await request(ctx.app).post('/api/planning/commit').set(h).send({ ...body, routes: [{ ...route, vehicleId: small.id }] }).expect(400);
    expect(res.body.error).toMatch(/HH-TW 202E would be overloaded/);
    const stillNew = await ctx.db.order.count({ where: { id: heavy.id, status: 'NEW' } });
    expect(stillNew).toBe(1); // nothing was written
    await request(ctx.app).post(`/api/orders/${heavy.id}/cancel`).set(h).expect(200);
  });

  test('concurrent commits of the same plan: exactly one wins', async () => {
    const { body } = await planDay(ctx, today);
    const h = await ctx.login(DISPO);
    const results = await Promise.all([1, 2, 3].map(() => request(ctx.app).post('/api/planning/commit').set(h).send(body)));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409]);
    const tours = await request(ctx.app).get(`/api/tours?day=${today}`).set(h).expect(200);
    expect(tours.body.length).toBe(body.routes.length);
    const res = await request(ctx.app).get(`/api/orders?day=${today}&status=NEW`).set(h).expect(200);
    expect(res.body.total).toBe(0);
  });
});

describe('tour execution', () => {
  test('driver sees only their own tour', async () => {
    const mine = await request(ctx.app).get('/api/tours/mine').set(await ctx.login(DRIVER1)).expect(200);
    expect(mine.body.vehicle.plate).toBe('HH-TW 101');
    await request(ctx.app).get(`/api/tours/${mine.body.id}`).set(await ctx.login(DRIVER2)).expect(403);
  });

  test('driver delivers stops; a failure needs a reason; completion exports to the ERP', async () => {
    const h = await ctx.login(DRIVER1);
    const tour = (await request(ctx.app).get('/api/tours/mine').set(h).expect(200)).body;
    const [first, second, ...rest] = tour.stops;
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${first.id}`).set(h).send({ event: 'DELIVERED' }).expect(409); // not started
    await request(ctx.app).post(`/api/tours/${tour.id}/start`).set(h).expect(200);
    await request(ctx.app).post(`/api/tours/${tour.id}/start`).set(h).expect(409);
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${first.id}`).set(h).send({ event: 'ARRIVED' }).expect(200);
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${first.id}`).set(h).send({ event: 'DELIVERED' }).expect(200);
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${first.id}`).set(h).send({ event: 'DELIVERED' }).expect(200); // retry is a no-op
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${second.id}`).set(h).send({ event: 'FAILED' }).expect(400);
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${second.id}`).set(h).send({ event: 'FAILED', reason: 'recipient_absent' }).expect(200);
    await request(ctx.app).post(`/api/tours/${tour.id}/stops/${second.id}`).set(h).send({ event: 'DELIVERED' }).expect(409);
    for (const s of rest) await request(ctx.app).post(`/api/tours/${tour.id}/stops/${s.id}`).set(h).send({ event: 'DELIVERED' }).expect(200);

    const done = (await request(ctx.app).get(`/api/tours/${tour.id}`).set(h).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    expect(ctx.erp.rows.size).toBe(tour.stops.length);
    expect([...ctx.erp.rows.values()].filter((r) => r.status === 'FAILED')).toHaveLength(1);
    expect(ctx.events.some((e) => e.type === 'tour' && (e.payload as { status: string }).status === 'COMPLETED')).toBe(true);
  });

  test('the C fleet simulator drives a tour to completion and records a GPS trail', async () => {
    const h = await ctx.login(DISPO);
    const tours = (await request(ctx.app).get(`/api/tours?day=${today}`).set(h).expect(200)).body;
    const tour = tours.find((t: { status: string }) => t.status === 'PLANNED');
    await request(ctx.app).post(`/api/tours/${tour.id}/simulate`).set(h).expect(202);
    expect(ctx.sim.isRunning(tour.id)).toBe(true);
    await ctx.sim.wait(tour.id);
    const done = (await request(ctx.app).get(`/api/tours/${tour.id}`).set(h).expect(200)).body;
    expect(done.status).toBe('COMPLETED');
    expect(done.drivenKm).toBeGreaterThan(0);
    expect(done.stops.every((s: { status: string }) => s.status === 'DELIVERED')).toBe(true);
    const trail = (await request(ctx.app).get(`/api/tours/${tour.id}/trail`).set(h).expect(200)).body;
    expect(trail.length).toBeGreaterThan(5);
    expect(ctx.events.filter((e) => e.type === 'position').length).toBeGreaterThan(5);

    // The ETA engine re-forecast the tour while it was driving; the last forecast has nothing left.
    const forecasts = ctx.events.filter((e) => e.type === 'eta' && (e.payload as { tourId: string }).tourId === tour.id).map((e) => e.payload as { stops: unknown[]; clockMin: number });
    expect(forecasts.length).toBeGreaterThan(2);
    expect(forecasts[0].stops.length).toBeGreaterThan(0);
    expect(forecasts.at(-1)!.stops).toHaveLength(0);
    await request(ctx.app).get(`/api/tours/${tour.id}/eta`).set(h).expect(409);
  });
});

describe('customer tracking', () => {
  test('signed links only; recipients see a narrow, live view of their own delivery', async () => {
    const h = await ctx.login(DISPO);
    await request(ctx.app).get('/api/track/TW-2026-00001.forgedforgedforgedforg').expect(404);
    await request(ctx.app).get('/api/track/nonsense').expect(404);

    const tours = (await request(ctx.app).get(`/api/tours?day=${today}`).set(h).expect(200)).body;
    const tour = tours.find((t: { status: string; stops: unknown[] }) => t.status === 'PLANNED' && t.stops.length > 4);
    const first = tour.stops[0].order, last = tour.stops.at(-1).order;
    const link = async (id: string) => (await request(ctx.app).get(`/api/orders/${id}/tracking-link`).set(h).expect(200)).body.path.replace('/track/', '');
    const firstToken = await link(first.id);
    expect(firstToken.startsWith(`${first.number}.`)).toBe(true);
    // Tampering with the order number invalidates the signature.
    await request(ctx.app).get(`/api/track/${last.number}${firstToken.slice(first.number.length)}`).expect(404);

    const before = (await request(ctx.app).get(`/api/track/${firstToken}`).expect(200)).body;
    expect(before).toMatchObject({ number: first.number, status: 'PLANNED', eta: null, van: null });
    expect(before.plannedEta.end - before.plannedEta.start).toBe(30);
    expect(before).not.toHaveProperty('customer');
    expect(before).not.toHaveProperty('phone');
    expect(before.driver).not.toContain(' '); // first name only

    await request(ctx.app).post(`/api/tours/${tour.id}/start`).set(h).expect(200);
    const live = (await request(ctx.app).get(`/api/track/${firstToken}`).expect(200)).body;
    expect(live.status).toBe('OUT_FOR_DELIVERY');
    expect(live.stopsBefore).toBe(0);
    expect(live.eta.start % 5).toBe(0);
    const far = (await request(ctx.app).get(`/api/track/${await link(last.id)}`).expect(200)).body;
    expect(far.stopsBefore).toBe(tour.stops.length - 1);
    expect(far.van).toBeNull(); // position is only shared for the next few stops
  });
});

describe('analytics', () => {
  test('summary reflects today’s deliveries', async () => {
    const s = (await request(ctx.app).get(`/api/analytics/summary?day=${today}`).set(await ctx.login(DISPO)).expect(200)).body;
    expect(s.orders.total).toBe(64);
    expect(s.orders.unplanned).toBe(0);
    expect(s.orders.delivered + s.orders.failed + s.orders.open).toBe(64);
    expect(s.orders.failed).toBe(1);
    expect(s.successRate).toBeGreaterThan(90);
    expect(s.tours.total).toBeGreaterThan(0);
  });

  test('trend has one row per day including Sundays without deliveries', async () => {
    const rows = (await request(ctx.app).get(`/api/analytics/trend?day=${addDays(today, -1)}&days=14`).set(await ctx.login(DISPO)).expect(200)).body;
    expect(rows).toHaveLength(14);
    const total = rows.reduce((s: number, r: { delivered: number }) => s + r.delivered, 0);
    expect(total).toBeGreaterThan(400);
    expect(rows.every((r: { onTimeRate: number | null }) => r.onTimeRate === null || (r.onTimeRate >= 0 && r.onTimeRate <= 100))).toBe(true);
  });

  test('district and vehicle scorecards; CSV export', async () => {
    const h = await ctx.login(DISPO);
    const d = (await request(ctx.app).get('/api/analytics/districts').set(h).expect(200)).body;
    expect(d[0]).toEqual(expect.objectContaining({ postcode: expect.any(String), failRate: expect.any(Number) }));
    const v = (await request(ctx.app).get('/api/analytics/vehicles').set(h).expect(200)).body;
    expect(v.find((x: { plate: string }) => x.plate === 'HH-TW 101').tours).toBeGreaterThanOrEqual(12);
    const csv = await request(ctx.app).get('/api/analytics/trend.csv').set(h).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toBe('day,delivered,failed,on_time_rate,km');
  });
});

describe('integration (Apache NiFi endpoint)', () => {
  const token = { 'x-integration-token': 'test-integration-token' };

  test('requires the integration token', async () => {
    await request(ctx.app).post('/api/integration/orders').send({}).expect(401);
    await request(ctx.app).post('/api/integration/orders').set({ 'x-integration-token': 'wrong-token-wrong-token' }).send({}).expect(401);
  });

  test('imports a CSV-shaped batch with per-row results and idempotency', async () => {
    const row = { externalRef: 'NIFI-1', customer: 'Atelier Nordlicht', street: 'Lange Reihe 5', postcode: '20099', weightKg: '7.5', parcels: '1', windowStart: '09:00', windowEnd: '12:00', deliveryDay: tomorrow, phone: '' };
    const res = await request(ctx.app)
      .post('/api/integration/orders')
      .set(token)
      .send({ orders: [row, { ...row }, { ...row, externalRef: 'NIFI-2', postcode: '99999' }, { ...row, externalRef: undefined }] })
      .expect(200);
    expect(res.body).toEqual(expect.objectContaining({ created: 1, duplicate: 1, rejected: 2 }));
    const order = await ctx.db.order.findUniqueOrThrow({ where: { externalRef: 'NIFI-1' } });
    expect(order).toEqual(expect.objectContaining({ windowStart: 540, windowEnd: 720, weightKg: 7.5, source: 'WEBSHOP' }));
  });
});
