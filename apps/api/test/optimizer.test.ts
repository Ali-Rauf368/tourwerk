import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config';
import { NativeOptimizer, parseProtocol, toProtocol, TsOptimizer, type OptimizerInput } from '../src/optimizer';

function problem(n: number, vehicles = 3, cap = 300): OptimizerInput {
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return {
    depot: { lat: 53.5378, lng: 10.0868, shiftStart: 420, shiftEnd: 1140 },
    speedKmh: 26,
    vehicles: Array.from({ length: vehicles }, (_, i) => ({ id: `v${i}`, capacityKg: cap })),
    orders: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, lat: 53.5 + r() * 0.1, lng: 9.9 + r() * 0.2, weightKg: 5 + r() * 25, serviceMin: 5, windowStart: i % 5 === 0 ? 600 : 480, windowEnd: i % 5 === 0 ? 720 : 1080 })),
  };
}

function assertValid(input: OptimizerInput, result: Awaited<ReturnType<TsOptimizer['solve']>>) {
  const seen = new Set<string>();
  for (const route of result.routes) {
    const v = input.vehicles.find((x) => x.id === route.vehicleId)!;
    const load = route.stops.reduce((s, x) => s + input.orders.find((o) => o.id === x.orderId)!.weightKg, 0);
    expect(load).toBeLessThanOrEqual(v.capacityKg + 1e-6);
    expect(route.returnMin).toBeLessThanOrEqual(input.depot.shiftEnd);
    for (const s of route.stops) {
      const o = input.orders.find((x) => x.id === s.orderId)!;
      expect(s.etaMin).toBeGreaterThanOrEqual(o.windowStart);
      expect(s.etaMin).toBeLessThanOrEqual(o.windowEnd);
      expect(seen.has(s.orderId)).toBe(false);
      seen.add(s.orderId);
    }
  }
  result.unassigned.forEach((id) => seen.add(id));
  expect(seen.size).toBe(input.orders.length);
}

describe('optimizer', () => {
  test('protocol round trip: serializes problems and parses plans', () => {
    const text = toProtocol(problem(2, 1));
    expect(text.split('\n')[0]).toBe('DEPOT 53.5378 10.0868 420 1140 26');
    expect(text).toContain('VEHICLE v0 300');
    expect(text.trim().endsWith('SOLVE')).toBe(true);
    const parsed = parseProtocol('ROUTE v0 12.500 610 40.00 o1@450 o0@480\nUNASSIGNED o9\nSTATS 12.500 3 1\nOK\n');
    expect(parsed.routes[0]).toEqual({ vehicleId: 'v0', distanceKm: 12.5, returnMin: 610, loadKg: 40, stops: [{ orderId: 'o1', etaMin: 450 }, { orderId: 'o0', etaMin: 480 }] });
    expect(parsed.unassigned).toEqual(['o9']);
    expect(parsed.improvements).toBe(3);
  });

  test('rejects ids that could inject protocol commands', () => {
    const p = problem(1, 1);
    p.orders[0].id = 'x\nSOLVE';
    expect(() => toProtocol(p)).toThrow(/invalid order id/);
  });

  test('parses the search trace, operator statistics and extended STATS', () => {
    const r = parseProtocol('ROUTE v1 12.5 600 80 a@500 b@530\nTRACE 0 0 20.000 1\nTRACE 41 3 12.500 0\nOP regret2 1.8 300 7\nSTATS 12.500 9 15 500 20.000\nOK\n');
    expect(r.trace).toEqual([{ iteration: 0, ms: 0, bestKm: 20, unassigned: 1 }, { iteration: 41, ms: 3, bestKm: 12.5, unassigned: 0 }]);
    expect(r.operators).toEqual([{ name: 'regret2', weight: 1.8, uses: 300, newBest: 7 }]);
    expect(r).toMatchObject({ totalKm: 12.5, iterations: 500, initialKm: 20, elapsedMs: 15 });
    expect(toProtocol({ ...problem(2), search: { timeMs: 800, maxIterations: 0, seed: 20261116 } })).toContain('PARAMS 800 0 20261116\nSOLVE');
  });

  test('TypeScript fallback produces a valid plan', async () => {
    const input = problem(40);
    assertValid(input, await new TsOptimizer().solve(input));
  });

  const binary = loadConfig({}).OPTIMIZER_PATH;
  (existsSync(binary) ? test : test.skip)('native C++ solver is valid and shorter than the greedy fallback', async () => {
    const input = problem(60);
    const native = await new NativeOptimizer(binary).solve(input);
    const greedy = await new TsOptimizer().solve(input);
    assertValid(input, native);
    expect(native.unassigned.length).toBeLessThanOrEqual(greedy.unassigned.length);
    if (native.unassigned.length === greedy.unassigned.length) expect(native.totalKm).toBeLessThan(greedy.totalKm);
  });

  (existsSync(binary) ? test : test.skip)('ALNS search is feasible, deterministic per seed and never worse than construction', async () => {
    const input = problem(60);
    const solver = new NativeOptimizer(binary);
    const plain = await solver.solve(input);
    const search = { timeMs: 0, maxIterations: 600, seed: 11 };
    const [a, b] = await Promise.all([solver.solve({ ...input, search }), solver.solve({ ...input, search })]);
    assertValid(input, a);
    expect(a.totalKm).toBeCloseTo(b.totalKm, 6);
    expect(a.iterations).toBe(600);
    expect(a.unassigned.length).toBeLessThanOrEqual(plain.unassigned.length);
    if (a.unassigned.length === plain.unassigned.length) expect(a.totalKm).toBeLessThanOrEqual(plain.totalKm + 1e-6);
    expect(a.trace[0].bestKm).toBeCloseTo(a.initialKm, 2);
    expect(a.operators.map((o) => o.name)).toEqual(['random', 'worst', 'related', 'greedy', 'regret2']);
    expect(a.operators.slice(0, 3).reduce((s, o) => s + o.uses, 0)).toBe(600);
  });
});
