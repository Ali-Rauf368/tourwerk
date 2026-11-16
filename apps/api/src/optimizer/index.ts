import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { haversineKm } from '../services/geo';

export interface OptimizerInput {
  depot: { lat: number; lng: number; shiftStart: number; shiftEnd: number };
  speedKmh: number;
  vehicles: { id: string; capacityKg: number }[];
  orders: { id: string; lat: number; lng: number; weightKg: number; serviceMin: number; windowStart: number; windowEnd: number }[];
  /** ALNS budget for the native solver; omitted = construction + local search only. */
  search?: { timeMs: number; maxIterations?: number; seed?: number };
}

export interface TracePoint { iteration: number; ms: number; bestKm: number; unassigned: number }
export interface OperatorStat { name: string; weight: number; uses: number; newBest: number }

export interface PlannedRoute {
  vehicleId: string;
  distanceKm: number;
  returnMin: number;
  loadKg: number;
  stops: { orderId: string; etaMin: number }[];
}

export interface OptimizerResult {
  engine: 'native' | 'typescript';
  routes: PlannedRoute[];
  unassigned: string[];
  totalKm: number;
  improvements: number;
  elapsedMs: number;
  /** Search statistics (native ALNS only; empty for the fallback). */
  iterations: number;
  initialKm: number;
  trace: TracePoint[];
  operators: OperatorStat[];
}

export interface Optimizer {
  readonly name: 'native' | 'typescript';
  solve(input: OptimizerInput): Promise<OptimizerResult>;
}

const ID = /^[A-Za-z0-9_-]{1,63}$/;

/** Serialize a problem into the line protocol of native/optimizer (see main.cpp). */
export function toProtocol(input: OptimizerInput) {
  const lines = [`DEPOT ${input.depot.lat} ${input.depot.lng} ${input.depot.shiftStart} ${input.depot.shiftEnd} ${input.speedKmh}`];
  for (const v of input.vehicles) {
    if (!ID.test(v.id)) throw new Error(`invalid vehicle id ${v.id}`);
    lines.push(`VEHICLE ${v.id} ${v.capacityKg}`);
  }
  for (const o of input.orders) {
    if (!ID.test(o.id)) throw new Error(`invalid order id ${o.id}`);
    lines.push(`ORDER ${o.id} ${o.lat} ${o.lng} ${o.weightKg} ${o.serviceMin} ${o.windowStart} ${o.windowEnd}`);
  }
  if (input.search) {
    const { timeMs, maxIterations = 0, seed = 1 } = input.search;
    lines.push(`PARAMS ${Math.round(timeMs)} ${Math.round(maxIterations)} ${Math.round(seed) >>> 0}`);
  }
  lines.push('SOLVE');
  return `${lines.join('\n')}\n`;
}

export function parseProtocol(output: string): Omit<OptimizerResult, 'engine'> {
  const result: Omit<OptimizerResult, 'engine'> = { routes: [], unassigned: [], totalKm: 0, improvements: 0, elapsedMs: 0, iterations: 0, initialKm: 0, trace: [], operators: [] };
  for (const line of output.split('\n')) {
    const [kind, ...f] = line.trim().split(/\s+/);
    if (kind === 'ROUTE') {
      const [vehicleId, km, ret, load, ...stops] = f;
      result.routes.push({
        vehicleId,
        distanceKm: Number(km),
        returnMin: Number(ret),
        loadKg: Number(load),
        stops: stops.map((s) => {
          const at = s.lastIndexOf('@');
          return { orderId: s.slice(0, at), etaMin: Number(s.slice(at + 1)) };
        }),
      });
    } else if (kind === 'UNASSIGNED') result.unassigned.push(f[0]);
    else if (kind === 'STATS') {
      result.totalKm = Number(f[0]);
      result.improvements = Number(f[1]);
      result.elapsedMs = Number(f[2]);
      result.iterations = Number(f[3] ?? 0);
      result.initialKm = Number(f[4] ?? f[0]);
    } else if (kind === 'TRACE') {
      result.trace.push({ iteration: Number(f[0]), ms: Number(f[1]), bestKm: Number(f[2]), unassigned: Number(f[3]) });
    } else if (kind === 'OP') {
      result.operators.push({ name: f[0], weight: Number(f[1]), uses: Number(f[2]), newBest: Number(f[3]) });
    } else if (kind === 'ERR') throw new Error(`optimizer: ${f.join(' ')}`);
  }
  return result;
}

/** Runs the C++ solver as a short-lived child process per request. */
export class NativeOptimizer implements Optimizer {
  readonly name = 'native' as const;
  constructor(private readonly binary: string) {}

  solve(input: OptimizerInput): Promise<OptimizerResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
      let out = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000 + (input.search?.timeMs ?? 0));
      child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`optimizer exited with ${code}`));
        try {
          resolve({ engine: 'native', ...parseProtocol(out) });
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.end(toProtocol(input));
    });
  }
}

/**
 * Fallback when the native binary is not built: greedy nearest-feasible-neighbour per
 * vehicle. Always valid (capacity, windows, shift), usually ~15–25 % longer than native.
 */
export class TsOptimizer implements Optimizer {
  readonly name = 'typescript' as const;

  async solve(input: OptimizerInput): Promise<OptimizerResult> {
    const t0 = Date.now();
    const { depot, speedKmh } = input;
    const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineKm(a, b) * 1.3;
    const mins = (d: number) => Math.ceil((d / speedKmh) * 60);
    const left = new Map(input.orders.map((o) => [o.id, o]));
    const routes: PlannedRoute[] = [];
    for (const v of [...input.vehicles].sort((a, b) => b.capacityKg - a.capacityKg)) {
      let pos: { lat: number; lng: number } = depot;
      let t = depot.shiftStart;
      let load = 0;
      let dist = 0;
      const stops: PlannedRoute['stops'] = [];
      for (;;) {
        let best: { id: string; eta: number; d: number } | null = null;
        for (const o of left.values()) {
          if (load + o.weightKg > v.capacityKg) continue;
          const d = km(pos, o);
          const eta = Math.max(t + mins(d), o.windowStart);
          if (eta > o.windowEnd || eta + o.serviceMin + mins(km(o, depot)) > depot.shiftEnd) continue;
          if (!best || eta < best.eta || (eta === best.eta && d < best.d)) best = { id: o.id, eta, d };
        }
        if (!best) break;
        const o = left.get(best.id)!;
        left.delete(best.id);
        stops.push({ orderId: o.id, etaMin: best.eta });
        dist += best.d;
        load += o.weightKg;
        t = best.eta + o.serviceMin;
        pos = o;
      }
      if (!stops.length) continue;
      const back = km(pos, depot);
      routes.push({ vehicleId: v.id, distanceKm: +(dist + back).toFixed(3), returnMin: t + mins(back), loadKg: load, stops });
    }
    const totalKm = routes.reduce((s, r) => s + r.distanceKm, 0);
    return { engine: 'typescript', routes, unassigned: [...left.keys()].sort(), totalKm, improvements: 0, elapsedMs: Date.now() - t0, iterations: 0, initialKm: totalKm, trace: [], operators: [] };
  }
}

export function createOptimizer(binary: string, log: (m: string) => void): Optimizer {
  if (existsSync(binary)) {
    log(`optimizer: native C++ solver (${binary})`);
    return new NativeOptimizer(binary);
  }
  log('optimizer: TypeScript fallback (run `npm run native` to build the C++ solver)');
  return new TsOptimizer();
}
