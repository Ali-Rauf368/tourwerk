import { clock } from '../lib/format';
import type { ScenarioResult } from '../lib/types';

const BAR = '#0f766e';

/**
 * Fleet-size what-if as a table with an inline cost bar: one row per fleet size, so cost,
 * distance and unserved orders can be compared without a dual-axis chart.
 */
export function FleetScenarios({ result, onClose }: { result: ScenarioResult; onClose(): void }) {
  const maxCost = Math.max(1, ...result.scenarios.map((s) => s.costEur));
  const rec = result.scenarios.find((s) => s.vans === result.recommended);
  return (
    <section className="card mt-4 p-4" aria-label="Fleet what-if">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Fleet size what-if</h3>
        <button className="text-xs text-slate-500 hover:text-slate-900" onClick={onClose}>Close</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {result.orders} open orders solved with 1–{result.scenarios.length} vans in parallel. Cost model: €{result.cost.perVanDay} per van-day, €{result.cost.perKm.toFixed(2)}/km, €{result.cost.perUnassigned} per order left for tomorrow.
      </p>
      {rec && (
        <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-slate-700" role="status">
          <b>Recommended: {rec.vansUsed} van{rec.vansUsed > 1 ? 's' : ''}</b>, {rec.totalKm.toFixed(0)} km, about €{rec.costEur}
          {rec.unassigned ? `, ${rec.unassigned} orders left over` : ', every order served'}
          {rec.lastReturn ? `, last van back ${clock(rec.lastReturn)}` : ''}.
        </p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1.5 font-medium">Vans</th>
              <th className="py-1.5 text-right font-medium">Distance</th>
              <th className="py-1.5 text-right font-medium">Unserved</th>
              <th className="py-1.5 text-right font-medium">Last back</th>
              <th className="py-1.5 text-right font-medium">Load</th>
              <th className="w-[34%] py-1.5 pl-4 pr-1 font-medium">Daily cost</th>
            </tr>
          </thead>
          <tbody>
            {result.scenarios.map((s) => {
              const best = s.vans === result.recommended;
              return (
                <tr key={s.vans} className={`border-t border-slate-100 ${best ? 'bg-brand-50/60 font-medium' : ''}`}>
                  <td className="py-1.5 tabular-nums" title={s.plates.join(', ')}>
                    {s.vans}
                    {s.vansUsed < s.vans && <span className="text-xs text-slate-400"> ({s.vansUsed} used)</span>}
                    {best && <span className="ml-1.5 text-xs text-brand-700">✓ best</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{s.totalKm.toFixed(0)} km</td>
                  <td className={`py-1.5 text-right tabular-nums ${s.unassigned ? 'text-rose-700' : 'text-slate-500'}`}>{s.unassigned}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.lastReturn ? clock(s.lastReturn) : '–'}</td>
                  <td className="py-1.5 text-right tabular-nums">{Math.round(s.utilization * 100)} %</td>
                  <td className="py-1.5 pl-4 pr-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full" style={{ width: `${(s.costEur / maxCost) * 100}%`, background: BAR, opacity: best ? 1 : 0.55 }} />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums">€{s.costEur}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
