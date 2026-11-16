import { useState } from 'react';
import { Link } from 'react-router';
import { TrendChart } from '../components/TrendChart';
import { DayPicker, ErrorNote, Kpi, LoadBar, PageHeader } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { api } from '../lib/api';
import { km, pct, prettyDay, shiftDay, today } from '../lib/format';
import type { Summary, TrendRow } from '../lib/types';
import { useApi } from '../lib/useApi';

interface District { postcode: string; delivered: number; failed: number; failRate: number | null; avgLateMin: number }
interface VehicleKpi { plate: string; label: string; electric: boolean; tours: number; stops: number; successRate: number | null; km: number; utilization: number | null }

export function Dashboard() {
  const [day, setDay] = useState(today);
  const { version } = useLive();
  const summary = useApi<Summary>(`/analytics/summary?day=${day}`, [version]);
  const trend = useApi<TrendRow[]>(`/analytics/trend?day=${day}&days=14`, [version]);
  const districts = useApi<District[]>(`/analytics/districts?day=${shiftDay(day, -1)}&days=14`);
  const vehicles = useApi<VehicleKpi[]>(`/analytics/vehicles?day=${day}&days=14`, [version]);
  const s = summary.data;

  async function downloadCsv() {
    const csv = await api<string>(`/analytics/trend.csv?day=${day}&days=30`);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `tourwerk-trend-${day}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={prettyDay(day)}
        actions={
          <>
            <DayPicker value={day} onChange={setDay} />
            <button className="btn-ghost" onClick={downloadCsv}>Export CSV</button>
          </>
        }
      />
      {summary.error && <ErrorNote>{summary.error}</ErrorNote>}
      {s && (
        <>
          {s.orders.unplanned > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span><b>{s.orders.unplanned}</b> orders for {prettyDay(day)} are not planned yet.</span>
              <Link to={`/dispatch?day=${day}`} className="btn-primary">Open dispatch</Link>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi label="Orders" value={s.orders.total} hint={`${s.orders.parcels} parcels · ${Math.round(s.orders.weightKg)} kg`} />
            <Kpi label="Delivered" value={s.orders.delivered} hint={`${s.orders.open} open · ${s.orders.failed} failed`} />
            <Kpi label="Success rate" value={pct(s.successRate)} tone={s.successRate === null ? 'default' : s.successRate >= 95 ? 'good' : 'warn'} hint="delivered / attempted" />
            <Kpi label="On time" value={pct(s.onTimeRate)} tone={s.onTimeRate === null ? 'default' : s.onTimeRate >= 90 ? 'good' : 'warn'} hint="within the customer window" />
            <Kpi label="Distance" value={km(s.drivenKm || s.plannedKm)} hint={`${s.tours.total} tours · ${s.tours.active} on the road`} />
            <Kpi label="Van utilization" value={pct(s.utilization)} hint={`${s.co2SavedKg} kg CO₂ avoided (EV)`} />
          </div>
        </>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card p-5 xl:col-span-2">
          <h2 className="mb-3 font-semibold">Last 14 days</h2>
          {trend.data ? <TrendChart rows={trend.data} /> : <div className="h-64 animate-pulse rounded bg-slate-100" />}
        </section>
        <section className="card p-5">
          <h2 className="font-semibold">Problem districts</h2>
          <p className="mb-3 text-xs text-slate-500">Failed deliveries by postcode, last 14 days</p>
          <table className="w-full">
            <thead><tr><th className="th">Postcode</th><th className="th text-right">Stops</th><th className="th text-right">Failed</th><th className="th text-right">Delay</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {districts.data?.slice(0, 8).map((d) => (
                <tr key={d.postcode}>
                  <td className="td font-mono">{d.postcode}</td>
                  <td className="td text-right tabular-nums">{d.delivered + d.failed}</td>
                  <td className={`td whitespace-nowrap text-right tabular-nums ${d.failRate && d.failRate >= 8 ? 'font-semibold text-rose-700' : ''}`}>{pct(d.failRate)}</td>
                  <td className="td whitespace-nowrap text-right tabular-nums text-slate-500">{d.avgLateMin} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card mt-6 overflow-x-auto p-5">
        <h2 className="mb-3 font-semibold">Vehicle scorecard <span className="text-xs font-normal text-slate-500">· 14 days</span></h2>
        <table className="w-full min-w-[640px]">
          <thead><tr><th className="th">Vehicle</th><th className="th text-right">Tours</th><th className="th text-right">Stops</th><th className="th text-right">Success</th><th className="th text-right">Distance</th><th className="th w-48">Avg. load</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.data?.map((v) => (
              <tr key={v.plate}>
                <td className="td"><span className="font-medium">{v.plate}</span> <span className="text-slate-500">{v.label}</span> {v.electric && <span className="ml-1 rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700">EV</span>}</td>
                <td className="td text-right tabular-nums">{v.tours}</td>
                <td className="td text-right tabular-nums">{v.stops}</td>
                <td className="td text-right tabular-nums">{pct(v.successRate)}</td>
                <td className="td text-right tabular-nums">{km(v.km)}</td>
                <td className="td"><div className="flex items-center gap-2"><LoadBar value={(v.utilization ?? 0) / 100} /><span className="w-14 whitespace-nowrap text-right text-xs tabular-nums text-slate-500">{pct(v.utilization)}</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
