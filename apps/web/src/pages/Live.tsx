import { useMemo } from 'react';
import { RouteMap } from '../components/RouteMap';
import { LoadBar, PageHeader, StatusBadge } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { clock, km, ROUTE_COLORS, today } from '../lib/format';
import type { Depot, Prediction, Tour } from '../lib/types';
import { useApi } from '../lib/useApi';

export function Live() {
  const { positions, forecasts: pushed, feed, connected, version } = useLive();
  const initial = useApi<Prediction[]>('/tours/eta', [version]);
  // Socket pushes are newer than the last fetch; fetched forecasts fill in tours without a push yet.
  const forecasts = useMemo(() => {
    const all: Record<string, Prediction> = {};
    for (const p of initial.data ?? []) all[p.tourId] = p;
    return { ...all, ...pushed };
  }, [initial.data, pushed]);
  const depot = useApi<Depot>('/fleet/depot');
  const tours = useApi<Tour[]>(`/tours?day=${today()}`, [version]);
  const list = tours.data ?? [];
  const color = useMemo(() => new Map(list.map((t, i) => [t.vehicle.id, ROUTE_COLORS[i % ROUTE_COLORS.length]])), [list]);
  const plateOfTour = new Map(list.map((t) => [t.id, t.vehicle.plate]));
  const active = list.filter((t) => t.status === 'IN_PROGRESS');
  const risky = active
    .map((t) => forecasts[t.id])
    .filter((p): p is Prediction => !!p)
    .flatMap((p) => p.stops.filter((s) => s.risk !== 'ok').map((s) => ({ ...s, tourId: p.tourId })))
    .sort((a, b) => a.slackMin - b.slackMin);

  return (
    <>
      <PageHeader
        title="Live map"
        subtitle={<span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />{active.length} vans on the road · positions stream over WebSockets</span>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {depot.data && (
            <RouteMap
              depot={depot.data}
              height={600}
              routes={list.map((t) => ({
                id: t.id,
                color: color.get(t.vehicle.id)!,
                dimmed: t.status === 'COMPLETED',
                stops: t.stops.map((s) => ({ id: s.id, lat: s.order.lat, lng: s.order.lng, status: s.status, title: `${s.order.customer} · ${s.status.toLowerCase()}` })),
              }))}
              vehicles={list
                .filter((t) => positions[t.vehicle.id] && t.status !== 'COMPLETED')
                .map((t) => {
                  const p = positions[t.vehicle.id];
                  return { id: t.vehicle.id, lat: p.lat, lng: p.lng, heading: p.heading, color: color.get(t.vehicle.id)!, label: t.vehicle.plate, clockMin: p.clockMin };
                })}
            />
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((t) => {
              const done = t.stops.filter((s) => s.status === 'DELIVERED' || s.status === 'FAILED').length;
              const p = positions[t.vehicle.id];
              return (
                <div key={t.id} className="card p-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color.get(t.vehicle.id) }} />{t.vehicle.plate}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="mt-2"><LoadBar value={done / Math.max(1, t.stops.length)} color={color.get(t.vehicle.id)} /></div>
                  <div className="mt-1.5 flex justify-between text-xs text-slate-500">
                    <span>{done}/{t.stops.length} stops</span>
                    <span>{p && t.status === 'IN_PROGRESS' ? `${Math.round(p.speedKmh)} km/h · ${clock(p.clockMin)}` : km(t.drivenKm ?? t.plannedKm)}</span>
                  </div>
                  {t.status === 'IN_PROGRESS' && forecasts[t.id] && <ForecastLine p={forecasts[t.id]} plannedReturn={t.plannedReturn} />}
                </div>
              );
            })}
          </div>
        </div>
        <aside className="flex max-h-[900px] flex-col gap-4">
          <section className="card p-4" aria-label="Stops at risk">
            <h2 className="flex items-center justify-between font-semibold">
              At risk
              <span className="text-xs font-normal text-slate-500">live ETA forecast</span>
            </h2>
            {!risky.length ? (
              <p className="mt-2 text-sm text-slate-500">{active.length ? 'Every remaining stop is forecast inside its window.' : 'No vans on the road.'}</p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-sm">
                {risky.slice(0, 30).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <RiskBadge risk={s.risk} />
                    <span className="min-w-0 flex-1 truncate"><b>{plateOfTour.get(s.tourId)}</b> · {s.customer}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-slate-500" title={`forecast ${clock(s.predictedMin)}, window closes ${clock(s.windowEnd)}`}>
                      {clock(s.predictedMin)} / {clock(s.windowEnd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card flex min-h-0 flex-1 flex-col p-4">
          <h2 className="mb-3 font-semibold">Events</h2>
          {!feed.length && <p className="text-sm text-slate-500">Waiting for events. Start a simulated drive in Dispatch.</p>}
          <ul className="-mr-2 flex-1 space-y-2 overflow-y-auto pr-2" aria-live="polite">
            {feed.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.kind === 'risk' ? 'bg-amber-500' : f.kind === 'failed' ? 'bg-rose-500' : f.kind === 'delivered' ? 'bg-emerald-500' : 'bg-sky-500'}`} />
                <div>
                  <div><b>{f.tourId ? plateOfTour.get(f.tourId) : ''}</b> {f.text}</div>
                  <div className="text-[11px] text-slate-400">{f.at.toLocaleTimeString('en-GB')}</div>
                </div>
              </li>
            ))}
          </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

function RiskBadge({ risk }: { risk: 'ok' | 'tight' | 'late' }) {
  const style = risk === 'late' ? 'bg-rose-50 text-rose-700 ring-rose-200' : risk === 'tight' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  return <span className={`inline-flex w-12 shrink-0 justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ${style}`}>{risk === 'late' ? '⚠ late' : risk === 'tight' ? '◔ tight' : '✓ ok'}</span>;
}

function ForecastLine({ p, plannedReturn }: { p: Prediction; plannedReturn: number }) {
  const behind = p.predictedReturn - plannedReturn;
  return (
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
      <span className="whitespace-nowrap" title="observed pace vs. plan">pace ×{p.pace.toFixed(2)}{p.late ? <b className="ml-1 text-rose-700">· {p.late} late</b> : p.tight ? <b className="ml-1 text-amber-700">· {p.tight} tight</b> : null}</span>
      <span className="whitespace-nowrap tabular-nums" title={`planned return ${clock(plannedReturn)}`}>
        back {clock(p.predictedReturn)}{' '}
        <span className={behind > 10 ? 'text-rose-700' : ''}>{Math.abs(behind) < 3 ? '(on plan)' : `(${Math.abs(behind)} min ${behind > 0 ? 'late' : 'early'})`}</span>
      </span>
    </div>
  );
}
