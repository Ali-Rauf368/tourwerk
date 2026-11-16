import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { RouteMap, type MapRoute } from '../components/RouteMap';
import { FleetScenarios } from '../components/FleetScenarios';
import { SearchInsight } from '../components/SearchInsight';
import { DayPicker, ErrorNote, LoadBar, PageHeader, StatusBadge } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { api } from '../lib/api';
import { clock, kg, km, prettyDay, ROUTE_COLORS, today } from '../lib/format';
import type { Depot, Plan, ScenarioResult, Summary, Tour } from '../lib/types';
import { useApi } from '../lib/useApi';

export function Dispatch() {
  const [params, setParams] = useSearchParams();
  const day = params.get('day') ?? today();
  const setDay = (d: string) => setParams({ day: d });
  const { version } = useLive();
  const depot = useApi<Depot>('/fleet/depot');
  const tours = useApi<Tour[]>(`/tours?day=${day}`, [version]);
  const summary = useApi<Summary>(`/analytics/summary?day=${day}`, [version]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioResult | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const optimize = () =>
    run('optimize', async () => {
      const p = await api<Plan>('/planning/optimize', { body: { day } });
      setPlan(p);
      setExcluded(new Set());
      setSelected(null);
      if (!p.routes.length) setNotice(p.vehiclesAvailable ? 'No unplanned orders for this day.' : 'All vehicles already have a tour on this day.');
    });

  const whatIf = () =>
    run('whatif', async () => {
      setScenarios(await api<ScenarioResult>('/planning/scenarios', { body: { day } }));
    });

  const commit = () =>
    run('commit', async () => {
      if (!plan) return;
      const routes = plan.routes.filter((r) => !excluded.has(r.vehicleId));
      const res = await api<{ tours: string[] }>('/planning/commit', {
        body: { day, engine: plan.engine, routes: routes.map((r) => ({ vehicleId: r.vehicleId, distanceKm: r.distanceKm, returnMin: r.returnMin, stops: r.stops.map((s) => ({ orderId: s.orderId, etaMin: s.etaMin })) })) },
      });
      setPlan(null);
      setNotice(`${res.tours.length} tours created. Drivers can see them now.`);
      setScenarios(null);
      tours.reload();
      summary.reload();
    });

  const simulate = (tourId: string) =>
    run(tourId, async () => {
      await api(`/tours/${tourId}/simulate`, { method: 'POST' });
      tours.reload();
    });

  const colorOf = useMemo(() => {
    const ids = [...(tours.data ?? []).map((t) => t.vehicle.id), ...(plan?.routes ?? []).map((r) => r.vehicleId)];
    const unique = [...new Set(ids)];
    return (vehicleId: string) => ROUTE_COLORS[unique.indexOf(vehicleId) % ROUTE_COLORS.length];
  }, [tours.data, plan]);

  const mapRoutes: MapRoute[] = plan
    ? plan.routes.map((r) => ({
        id: r.vehicleId,
        color: colorOf(r.vehicleId),
        dimmed: excluded.has(r.vehicleId),
        stops: r.stops.map((s) => ({ id: s.orderId, lat: s.lat, lng: s.lng, title: `${s.number} · ${s.customer}, ${s.street} · ETA ${clock(s.etaMin)} (window ${clock(s.windowStart)}–${clock(s.windowEnd)})` })),
      }))
    : (tours.data ?? []).map((t) => ({
        id: t.vehicle.id,
        color: colorOf(t.vehicle.id),
        stops: t.stops.map((s) => ({ id: s.id, lat: s.order.lat, lng: s.order.lng, status: s.status, title: `${s.order.number} · ${s.order.customer} · ETA ${clock(s.etaMin)}` })),
      }));

  const kept = plan?.routes.filter((r) => !excluded.has(r.vehicleId)) ?? [];
  const savings = plan && plan.baselineKm ? Math.round((1 - plan.totalKm / plan.baselineKm) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Dispatch"
        subtitle={`${prettyDay(day)} · ${summary.data?.orders.unplanned ?? '…'} unplanned of ${summary.data?.orders.total ?? '…'} orders`}
        actions={
          <>
            <DayPicker value={day} onChange={(d) => (setDay(d), setPlan(null), setScenarios(null))} />
            <button className="btn-ghost" onClick={whatIf} disabled={!!busy || !summary.data?.orders.unplanned}>
              {busy === 'whatif' ? 'Comparing…' : 'Fleet what-if'}
            </button>
            <button className="btn-primary" onClick={optimize} disabled={!!busy || summary.data?.orders.unplanned === 0}>
              {busy === 'optimize' ? 'Optimizing…' : 'Optimize routes'}
            </button>
          </>
        }
      />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0">
          {depot.data && (
            <RouteMap
              depot={depot.data}
              routes={mapRoutes}
              loose={plan?.unassigned.map((u) => ({ id: u.id, lat: u.lat, lng: u.lng, title: `${u.number} · ${u.customer} – not assigned` })) ?? []}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {plan && (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Planned distance" value={km(plan.totalKm)} hint={`${savings}% less than single trips (${km(plan.baselineKm)})`} />
              <Stat label="Routes" value={`${plan.routes.length} / ${plan.vehiclesAvailable}`} hint="vehicles used / free" />
              <Stat label="Unassigned" value={String(plan.unassigned.length)} hint={plan.unassigned.length ? 'capacity or time windows' : 'every order fits'} />
              <Stat label="Solver" value={`${plan.elapsedMs} ms`} hint={`${plan.engine === 'native' ? 'C++ ALNS' : 'TypeScript fallback'} · ${plan.improvements} improvements`} />
            </div>
          )}
          {scenarios && <FleetScenarios result={scenarios} onClose={() => setScenarios(null)} />}
          {plan && plan.search.iterations > 0 && <SearchInsight search={plan.search} totalKm={plan.totalKm} elapsedMs={plan.elapsedMs} />}
        </div>

        <aside className="space-y-3">
          {plan ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Proposal</h2>
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={() => setPlan(null)} disabled={!!busy}>Discard</button>
                  <button className="btn-primary" onClick={commit} disabled={!!busy || !kept.length}>{busy === 'commit' ? 'Saving…' : `Commit ${kept.length} tours`}</button>
                </div>
              </div>
              {plan.routes.map((r) => (
                <article key={r.vehicleId} className={`card cursor-pointer p-4 transition ${selected === r.vehicleId ? 'ring-2 ring-brand-500' : ''} ${excluded.has(r.vehicleId) ? 'opacity-50' : ''}`} onClick={() => setSelected(r.vehicleId === selected ? null : r.vehicleId)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: colorOf(r.vehicleId) }} />
                      <span className="font-medium">{r.vehicle.plate}</span>
                      <span className="text-sm text-slate-500">{r.vehicle.driver?.name}</span>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!excluded.has(r.vehicleId)} onChange={(e) => setExcluded((x) => { const n = new Set(x); if (e.target.checked) n.delete(r.vehicleId); else n.add(r.vehicleId); return n; })} />
                      include
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-3 text-xs text-slate-600">
                    <span><b className="text-slate-900">{r.stops.length}</b> stops</span>
                    <span><b className="text-slate-900">{km(r.distanceKm)}</b></span>
                    <span>back <b className="text-slate-900">{clock(r.returnMin)}</b></span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <LoadBar value={r.utilization} color={colorOf(r.vehicleId)} />
                    <span className="whitespace-nowrap tabular-nums">{kg(r.loadKg)} / {kg(r.vehicle.capacityKg)}</span>
                  </div>
                  {selected === r.vehicleId && (
                    <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs">
                      {r.stops.map((s, i) => (
                        <li key={s.orderId} className="flex gap-2">
                          <span className="w-5 text-right font-semibold text-slate-400">{i + 1}</span>
                          <span className="w-10 tabular-nums">{clock(s.etaMin)}</span>
                          <span className="min-w-0 flex-1 truncate">{s.customer} · {s.street}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              ))}
              {plan.unassigned.length > 0 && (
                <div className="card p-4 text-sm">
                  <div className="font-medium text-amber-700">{plan.unassigned.length} orders could not be assigned</div>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {plan.unassigned.map((u) => <li key={u.id}>{u.number} · {u.customer} · {u.weightKg} kg · {clock(u.windowStart)}–{clock(u.windowEnd)}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="font-semibold">Tours</h2>
              {!tours.data?.length && <p className="text-sm text-slate-500">No tours yet. Optimize the day to create them.</p>}
              {tours.data?.map((t) => {
                const done = t.stops.filter((s) => s.status === 'DELIVERED' || s.status === 'FAILED').length;
                return (
                  <article key={t.id} className="card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: colorOf(t.vehicle.id) }} />
                        <span className="font-medium">{t.vehicle.plate}</span>
                        <span className="text-sm text-slate-500">{t.vehicle.driver?.name}</span>
                      </div>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <LoadBar value={done / Math.max(1, t.stops.length)} color={colorOf(t.vehicle.id)} />
                      <span className="whitespace-nowrap tabular-nums">{done}/{t.stops.length} stops</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>{km(t.drivenKm ?? t.plannedKm)} · back {clock(t.plannedReturn)}</span>
                      {t.status !== 'COMPLETED' && (
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => simulate(t.id)} disabled={!!busy || t.simulating}>
                          {t.simulating ? 'Driving…' : 'Simulate drive'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}
