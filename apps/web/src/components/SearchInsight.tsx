import { useState } from 'react';
import type { PlanSearch } from '../lib/types';

const LINE = '#0f766e';
const LABELS: Record<string, string> = {
  random: 'Random removal',
  worst: 'Worst-detour removal',
  related: 'Related (Shaw) removal',
  greedy: 'Greedy insertion',
  regret2: 'Regret-2 insertion',
};

/**
 * How the ALNS search got to the proposal: best distance over solve time (a step line,
 * since the best only changes when a better solution is found) and how the adaptive
 * operator weights ended up.
 */
export function SearchInsight({ search, totalKm, elapsedMs }: { search: PlanSearch; totalKm: number; elapsedMs: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = search.trace.length ? search.trace : [{ iteration: 0, ms: 0, bestKm: totalKm, unassigned: 0 }];
  const W = 640, H = 180, L = 50, R = 10, T = 10, B = 24;
  const maxMs = Math.max(1, elapsedMs, ...pts.map((p) => p.ms));
  const hi = Math.max(...pts.map((p) => p.bestKm), search.initialKm);
  const lo = Math.min(...pts.map((p) => p.bestKm), totalKm);
  const pad = Math.max(0.5, (hi - lo) * 0.1);
  const x = (ms: number) => L + ((W - L - R) * ms) / maxMs;
  const y = (km: number) => T + (H - T - B) * (1 - (km - (lo - pad)) / (hi + pad - (lo - pad)));
  let d = `M${x(pts[0].ms)},${y(pts[0].bestKm)}`;
  for (const p of pts.slice(1)) d += ` H${x(p.ms)} V${y(p.bestKm)}`;
  d += ` H${x(maxMs)}`;
  const gain = search.initialKm > 0 ? Math.round((1 - totalKm / search.initialKm) * 1000) / 10 : 0;
  const yTicks = [lo, (lo + hi) / 2, hi];
  const ops = search.operators;
  const maxWeight = Math.max(1, ...ops.map((o) => o.weight));
  const h = hover !== null ? pts[hover] : null;

  return (
    <section className="card mt-4 p-4" aria-label="Solver insight">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Adaptive large neighbourhood search</h3>
        <p className="text-xs text-slate-500">
          {search.iterations.toLocaleString('en-GB')} iterations · construction {search.initialKm.toFixed(1)} km → <b className="text-slate-900">{totalKm.toFixed(1)} km</b> ({gain > 0 ? `−${gain}` : '0'} %)
        </p>
      </div>
      <div className="mt-3 space-y-4">
        <div className="relative min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Best route distance fell from ${search.initialKm.toFixed(1)} to ${totalKm.toFixed(1)} km`}>
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
                <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{t.toFixed(0)} km</text>
              </g>
            ))}
            {[0, maxMs / 2, maxMs].map((t) => (
              <text key={t} x={x(t)} y={H - 6} textAnchor={t === 0 ? 'start' : t === maxMs ? 'end' : 'middle'} className="fill-slate-400 text-[10px]">{Math.round(t)} ms</text>
            ))}
            <path d={d} fill="none" stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={x(p.ms)} cy={y(p.bestKm)} r={hover === i ? 5 : 0} fill={LINE} stroke="white" strokeWidth="2" />
            ))}
            {h && <line x1={x(h.ms)} x2={x(h.ms)} y1={T} y2={H - B} stroke="#94a3b8" strokeDasharray="2 3" />}
            {pts.map((p, i) => {
              const next = pts[i + 1]?.ms ?? maxMs;
              const left = i === 0 ? L : (x(pts[i - 1].ms) + x(p.ms)) / 2;
              const right = (x(p.ms) + x(next)) / 2;
              return <rect key={i} x={left} y={0} width={Math.max(2, right - left)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />;
            })}
          </svg>
          {h && (
            <div className="pointer-events-none absolute right-2 top-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
              <div className="font-semibold text-slate-800">{h.bestKm.toFixed(2)} km</div>
              <div className="text-slate-600">iteration {h.iteration.toLocaleString('en-GB')} · {h.ms} ms{h.unassigned ? ` · ${h.unassigned} unassigned` : ''}</div>
            </div>
          )}
        </div>
        <table className="w-full text-xs">
          <caption className="mb-1 text-left text-slate-500">Operator weights · new bests / uses</caption>
          <tbody className="grid gap-x-6 sm:grid-cols-2">
            {ops.map((o) => (
              <tr key={o.name} className="flex items-center gap-3 border-t border-slate-100">
                <td className="flex-1 py-1.5">
                  <div className="text-slate-700">{LABELS[o.name] ?? o.name}</div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full" style={{ width: `${(o.weight / maxWeight) * 100}%`, background: LINE }} />
                  </div>
                </td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-slate-500" title={`${o.uses} uses, ${o.newBest} new best solutions`}>
                  {o.newBest} / {o.uses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
