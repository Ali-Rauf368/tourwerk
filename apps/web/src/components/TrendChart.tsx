import { useState } from 'react';
import { pct, prettyDay } from '../lib/format';
import type { TrendRow } from '../lib/types';

const DELIVERED = '#0d9488';
const FAILED = '#e11d48';

/**
 * Two charts sharing one x-axis instead of a dual-axis chart: stacked daily volume
 * (delivered/failed) on top, on-time rate below. Hover shows the day's values.
 */
export function TrendChart({ rows }: { rows: TrendRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const L = 36;
  const R = 8;
  const H1 = 170;
  const H2 = 120;
  const max = Math.max(10, ...rows.map((r) => r.delivered + r.failed));
  const step = (W - L - R) / Math.max(1, rows.length);
  const bw = Math.max(4, step - 6);
  const y1 = (v: number) => 10 + (H1 - 30) * (1 - v / max);
  // On-time rate lives in 60–100 % in practice; clamp so outliers stay on the chart.
  const y2 = (v: number) => H1 + 14 + (H2 - 28) * (1 - (Math.max(60, v) - 60) / 40);
  const ticks = [0, Math.round(max / 2), max];
  const linePts = rows.map((r, i) => (r.onTimeRate === null ? null : `${L + i * step + step / 2},${y2(r.onTimeRate)}`));
  const segments: string[][] = [[]];
  linePts.forEach((p) => (p ? segments[segments.length - 1].push(p) : segments.push([])));
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DELIVERED }} />Delivered</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FAILED }} />Failed</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 bg-slate-700" />On-time rate</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H1 + H2}`} className="h-auto w-full" role="img" aria-label="Deliveries per day and on-time rate">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y1(t)} y2={y1(t)} stroke="#e2e8f0" />
            <text x={L - 6} y={y1(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{t}</text>
          </g>
        ))}
        {[60, 80, 100].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y2(t)} y2={y2(t)} stroke="#e2e8f0" strokeDasharray={t === 100 ? undefined : '3 3'} />
            <text x={L - 6} y={y2(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{t}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = L + i * step + (step - bw) / 2;
          const yd = y1(r.delivered);
          const yf = y1(r.delivered + r.failed);
          const base = y1(0);
          return (
            <g key={r.day}>
              {r.delivered > 0 && <path d={`M${x},${base} V${yd + 2} H${x + bw} V${base} Z`} fill={DELIVERED} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {r.failed > 0 && <rect x={x} y={yf} width={bw} height={Math.max(2, yd - yf)} rx="3" fill={FAILED} opacity={hover === null || hover === i ? 1 : 0.45} />}
              <text x={x + bw / 2} y={H1 - 4} textAnchor="middle" className="fill-slate-400 text-[10px]">{r.day.slice(8)}</text>
            </g>
          );
        })}
        {segments.filter((s) => s.length).map((s, i) => (
          <polyline key={i} points={s.join(' ')} fill="none" stroke="#334155" strokeWidth="2" strokeLinejoin="round" />
        ))}
        {rows.map((r, i) =>
          r.onTimeRate === null ? null : <circle key={r.day} cx={L + i * step + step / 2} cy={y2(r.onTimeRate)} r={hover === i ? 4.5 : 3} fill="#334155" stroke="white" strokeWidth="2" />,
        )}
        {hover !== null && <line x1={L + hover * step + step / 2} x2={L + hover * step + step / 2} y1={8} y2={H1 + H2 - 10} stroke="#94a3b8" strokeDasharray="2 3" />}
        {rows.map((r, i) => (
          <rect key={r.day} x={L + i * step} y={0} width={step} height={H1 + H2} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute right-2 top-7 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
          <div className="font-semibold text-slate-800">{prettyDay(h.day)}</div>
          <div className="text-slate-600">Delivered <b className="text-slate-900">{h.delivered}</b> · Failed <b className="text-slate-900">{h.failed}</b></div>
          <div className="text-slate-600">On time <b className="text-slate-900">{pct(h.onTimeRate)}</b> · {h.km} km</div>
        </div>
      )}
    </div>
  );
}
