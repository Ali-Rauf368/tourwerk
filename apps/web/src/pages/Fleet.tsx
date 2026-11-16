import { useState, type FormEvent } from 'react';
import { ErrorNote, PageHeader } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { kg } from '../lib/format';
import type { Vehicle } from '../lib/types';
import { useApi } from '../lib/useApi';

interface Driver { id: string; name: string; email: string; active: boolean; driverOf: { id: string; plate: string } | null }

export function Fleet() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const vehicles = useApi<Vehicle[]>('/fleet/vehicles');
  const drivers = useApi<Driver[]>('/fleet/drivers');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ plate: '', label: '', capacityKg: '', electric: false });

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      vehicles.reload();
      drivers.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api('/fleet/vehicles', { body: { ...form, capacityKg: Number(form.capacityKg) } });
      setForm({ plate: '', label: '', capacityKg: '', electric: false });
    });
  };

  const free = drivers.data?.filter((d) => !d.driverOf) ?? [];

  return (
    <>
      <PageHeader title="Fleet" subtitle={`${vehicles.data?.filter((v) => v.active).length ?? '…'} active vehicles · ${drivers.data?.length ?? '…'} drivers`} />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50"><tr><th className="th">Plate</th><th className="th">Vehicle</th><th className="th text-right">Capacity</th><th className="th">Driver</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.data?.map((v) => (
              <tr key={v.id}>
                <td className="td font-medium">{v.plate}</td>
                <td className="td">{v.label} {v.electric && <span className="ml-1 rounded bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700">EV</span>}</td>
                <td className="td text-right tabular-nums">{kg(v.capacityKg)}</td>
                <td className="td">
                  {isAdmin ? (
                    <select aria-label={`Driver of ${v.plate}`} className="input py-1" value={v.driver?.id ?? ''} onChange={(e) => act(() => api(`/fleet/vehicles/${v.id}`, { method: 'PATCH', body: { driverId: e.target.value || null } }))}>
                      <option value="">– none –</option>
                      {v.driver && <option value={v.driver.id}>{v.driver.name}</option>}
                      {free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : (v.driver?.name ?? '–')}
                </td>
                <td className="td">
                  {isAdmin ? (
                    <button className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`} onClick={() => act(() => api(`/fleet/vehicles/${v.id}`, { method: 'PATCH', body: { active: !v.active } }))}>
                      {v.active ? 'Active' : 'Inactive'}
                    </button>
                  ) : v.active ? 'Active' : 'Inactive'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdmin && (
        <form onSubmit={add} className="card mt-6 grid gap-3 p-5 sm:grid-cols-5 sm:items-end" aria-label="Add vehicle">
          <div><label className="label" htmlFor="plate">Plate</label><input id="plate" className="input" placeholder="HH-TW 401" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
          <div><label className="label" htmlFor="vlabel">Model</label><input id="vlabel" className="input" placeholder="eCrafter" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
          <div><label className="label" htmlFor="cap">Capacity (kg)</label><input id="cap" className="input" inputMode="numeric" value={form.capacityKg} onChange={(e) => setForm({ ...form, capacityKg: e.target.value })} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={form.electric} onChange={(e) => setForm({ ...form, electric: e.target.checked })} /> Electric</label>
          <button className="btn-primary">Add vehicle</button>
        </form>
      )}
    </>
  );
}
