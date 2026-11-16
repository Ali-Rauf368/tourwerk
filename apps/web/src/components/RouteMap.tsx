import { useMemo, useState } from 'react';
import { clock } from '../lib/format';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  title?: string;
  status?: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED';
}
export interface MapRoute {
  id: string;
  color: string;
  stops: MapPoint[];
  dimmed?: boolean;
}
export interface MapVehicle {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  color: string;
  label: string;
  clockMin?: number;
}

// Stylised Hamburg landmarks for orientation (no tile server or API key needed).
const ELBE: [number, number][] = [[53.5465, 9.82], [53.5455, 9.88], [53.5445, 9.93], [53.5435, 9.965], [53.539, 9.99], [53.532, 10.02], [53.522, 10.045], [53.51, 10.075], [53.495, 10.11], [53.48, 10.15]];
const ALSTER: [number, number][] = [[53.5545, 9.995], [53.559, 9.9935], [53.567, 9.998], [53.574, 10.005], [53.5735, 10.012], [53.565, 10.013], [53.558, 10.006], [53.555, 10.0]];
const LABELS: [string, number, number][] = [
  ['Altona', 53.551, 9.935], ['Eimsbüttel', 53.575, 9.953], ['Eppendorf', 53.589, 9.986], ['Winterhude', 53.591, 10.021], ['Barmbek', 53.582, 10.044],
  ['Wandsbek', 53.573, 10.081], ['St. Georg', 53.555, 10.015], ['HafenCity', 53.541, 9.995], ['Hamm', 53.553, 10.057], ['Billstedt', 53.540, 10.121],
  ['Wilhelmsburg', 53.499, 10.011], ['Ottensen', 53.554, 9.925], ['Horn', 53.553, 10.089],
];

interface Props {
  depot: { lat: number; lng: number; name?: string };
  routes?: MapRoute[];
  loose?: MapPoint[];
  vehicles?: MapVehicle[];
  height?: number;
  onSelect?(routeId: string | null): void;
  selected?: string | null;
}

const W = 1000;

/** Equirectangular projection fitted to the data, corrected for latitude so distances look right. */
export function RouteMap({ depot, routes = [], loose = [], vehicles = [], height = 520, onSelect, selected }: Props) {
  const [hover, setHover] = useState<MapPoint | null>(null);
  const H = Math.round((W * height) / 900);
  const project = useMemo(() => {
    const pts = [depot, ...routes.flatMap((r) => r.stops), ...loose, ...vehicles];
    let minLat = Math.min(...pts.map((p) => p.lat));
    let maxLat = Math.max(...pts.map((p) => p.lat));
    let minLng = Math.min(...pts.map((p) => p.lng));
    let maxLng = Math.max(...pts.map((p) => p.lng));
    if (pts.length < 3) {
      minLat = 53.49; maxLat = 53.61; minLng = 9.88; maxLng = 10.14;
    }
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const pad = 0.08;
    const spanX = (maxLng - minLng) * k || 0.01;
    const spanY = maxLat - minLat || 0.01;
    const scale = Math.min(W / (spanX * (1 + 2 * pad)), H / (spanY * (1 + 2 * pad)));
    const cx = (minLng + maxLng) / 2;
    const cy = (minLat + maxLat) / 2;
    return (lat: number, lng: number) => [W / 2 + (lng - cx) * k * scale, H / 2 - (lat - cy) * scale] as const;
  }, [depot, routes, loose, vehicles, H]);

  const path = (pts: [number, number][]) => pts.map(([lat, lng], i) => `${i ? 'L' : 'M'}${project(lat, lng).join(',')}`).join(' ');
  const [dx, dy] = project(depot.lat, depot.lng);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-[#f4f6f3]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Route map" onClick={() => onSelect?.(null)}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#e2e8e0" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)" />
        <path d={path(ELBE)} fill="none" stroke="#bfdbfe" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
        <path d={`${path(ALSTER)} Z`} fill="#bfdbfe" />
        {LABELS.map(([name, lat, lng]) => {
          const [x, y] = project(lat, lng);
          return (
            <text key={name} x={x} y={y} textAnchor="middle" className="fill-slate-400 text-[13px] font-medium uppercase tracking-widest select-none" opacity="0.7">
              {name}
            </text>
          );
        })}

        {routes.map((r) => {
          const pts: [number, number][] = [[depot.lat, depot.lng], ...r.stops.map((s) => [s.lat, s.lng] as [number, number]), [depot.lat, depot.lng]];
          const faded = r.dimmed || (selected && selected !== r.id);
          return (
            <g key={r.id} opacity={faded ? 0.18 : 1} className="cursor-pointer" onClick={(e) => (e.stopPropagation(), onSelect?.(r.id))}>
              <path d={path(pts)} fill="none" stroke={r.color} strokeWidth={selected === r.id ? 4 : 2.5} strokeLinejoin="round" strokeDasharray={undefined} />
              {r.stops.map((s, i) => {
                const [x, y] = project(s.lat, s.lng);
                const done = s.status === 'DELIVERED';
                const failed = s.status === 'FAILED';
                return (
                  <g key={s.id} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}>
                    <circle cx={x} cy={y} r={9} fill={failed ? '#e11d48' : done ? r.color : 'white'} stroke={r.color} strokeWidth="2.5" />
                    <text x={x} y={y + 3.5} textAnchor="middle" className="pointer-events-none text-[10px] font-bold" fill={done || failed ? 'white' : r.color}>
                      {s.label ?? i + 1}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {loose.map((p) => {
          const [x, y] = project(p.lat, p.lng);
          return <circle key={p.id} cx={x} cy={y} r={5} fill="#64748b" stroke="white" strokeWidth="1.5" onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} />;
        })}

        <g>
          <rect x={dx - 13} y={dy - 13} width="26" height="26" rx="6" fill="#0f172a" />
          <path d={`M${dx - 6} ${dy + 5}V${dy - 2}L${dx} ${dy - 7}L${dx + 6} ${dy - 2}V${dy + 5}Z`} fill="white" />
        </g>

        {vehicles.map((v) => {
          const [x, y] = project(v.lat, v.lng);
          return (
            <g key={v.id} transform={`translate(${x} ${y})`} style={{ transition: 'transform 0.6s linear' }}>
              <circle r="16" fill={v.color} opacity="0.18">
                <animate attributeName="r" values="12;20;12" dur="2s" repeatCount="indefinite" />
              </circle>
              <g transform={`rotate(${v.heading})`}>
                <path d="M0 -11 L7 8 L0 4 L-7 8 Z" fill={v.color} stroke="white" strokeWidth="1.5" />
              </g>
              <text y="-16" textAnchor="middle" className="text-[11px] font-semibold" fill="#0f172a" stroke="white" strokeWidth="3" paintOrder="stroke">
                {v.label}
                {v.clockMin !== undefined ? ` · ${clock(v.clockMin)}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg">
          {hover.title ?? hover.label}
        </div>
      )}
    </div>
  );
}
