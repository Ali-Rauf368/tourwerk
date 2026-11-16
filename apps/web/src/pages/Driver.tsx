import { useState } from 'react';
import { ErrorNote, LoadBar, StatusBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { api } from '../lib/api';
import { clock, FAIL_LABEL, km } from '../lib/format';
import type { Stop, Tour } from '../lib/types';
import { useApi } from '../lib/useApi';

/** Mobile-first view for drivers: today's stops in order, with one-tap delivery actions. */
export function Driver() {
  const { user, logout } = useAuth();
  const { version } = useLive();
  const tour = useApi<Tour | null>('/tours/mine', [version]);
  const [error, setError] = useState<string | null>(null);
  const [failing, setFailing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = tour.data;

  async function send(path: string, body?: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      tour.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const next = t?.stops.find((s) => s.status === 'PENDING' || s.status === 'ARRIVED');
  const done = t?.stops.filter((s) => s.status === 'DELIVERED' || s.status === 'FAILED').length ?? 0;

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 pb-10">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
        <div>
          <div className="text-sm font-semibold">{user?.name}</div>
          <div className="text-xs text-slate-400">{user?.vehicle?.plate ?? 'No vehicle assigned'}</div>
        </div>
        <button className="text-xs text-slate-300 underline" onClick={logout}>Sign out</button>
      </header>
      <div className="space-y-3 p-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        {tour.loading && !t && <div className="h-32 animate-pulse rounded-xl bg-slate-200" />}
        {!tour.loading && !t && <div className="card p-6 text-center text-slate-500">No tour planned for you today.</div>}
        {t && (
          <>
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold">Today’s tour</h1>
                <StatusBadge status={t.status} />
              </div>
              <div className="mt-1 text-sm text-slate-500">{t.stops.length} stops · {km(t.plannedKm)} · back at {clock(t.plannedReturn)}</div>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><LoadBar value={done / t.stops.length} /> {done}/{t.stops.length}</div>
              {t.status === 'PLANNED' && <button className="btn-primary mt-4 w-full py-3" onClick={() => send(`/tours/${t.id}/start`)}>Start tour</button>}
            </div>
            <ol className="space-y-2">
              {t.stops.map((s) => (
                <StopCard key={s.id} stop={s} busy={busy || tour.loading} active={t.status === 'IN_PROGRESS' && s.id === next?.id} failing={failing === s.id}
                  onArrive={() => send(`/tours/${t.id}/stops/${s.id}`, { event: 'ARRIVED' })}
                  onDeliver={() => send(`/tours/${t.id}/stops/${s.id}`, { event: 'DELIVERED' })}
                  onFailStart={() => setFailing(s.id)}
                  onFail={(reason) => (setFailing(null), send(`/tours/${t.id}/stops/${s.id}`, { event: 'FAILED', reason }))}
                  onFailCancel={() => setFailing(null)}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function StopCard(p: { stop: Stop; busy: boolean; active: boolean; failing: boolean; onArrive(): void; onDeliver(): void; onFailStart(): void; onFail(reason: string): void; onFailCancel(): void }) {
  const { stop: s } = p;
  const o = s.order;
  return (
    <li className={`card p-4 ${p.active ? 'ring-2 ring-brand-500' : ''} ${s.status === 'DELIVERED' || s.status === 'FAILED' ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{s.seq}</span>
          <div>
            <div className="font-medium">{o.customer}</div>
            <div className="text-sm text-slate-600">{o.street}, {o.postcode}</div>
            <div className="mt-0.5 text-xs text-slate-500">ETA {clock(s.etaMin)} · window {clock(o.windowStart)}–{clock(o.windowEnd)} · {o.parcels} parcel{o.parcels > 1 ? 's' : ''}</div>
            {o.note && <div className="mt-1 text-xs text-amber-700">Note: {o.note}</div>}
          </div>
        </div>
        <StatusBadge status={s.status} />
      </div>
      {p.active && !p.failing && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button className="btn-ghost py-3" onClick={p.onArrive} disabled={p.busy || s.status === 'ARRIVED'}>Arrived</button>
          <button className="btn-primary py-3" onClick={p.onDeliver} disabled={p.busy}>Delivered</button>
          <button className="btn-danger py-3" onClick={p.onFailStart} disabled={p.busy}>Problem</button>
        </div>
      )}
      {p.failing && (
        <div className="mt-3 space-y-2">
          <div className="text-sm font-medium">What went wrong?</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(FAIL_LABEL).map(([k, label]) => <button key={k} className="btn-danger" disabled={p.busy} onClick={() => p.onFail(k)}>{label}</button>)}
          </div>
          <button className="w-full text-xs text-slate-500 underline" onClick={p.onFailCancel}>Back</button>
        </div>
      )}
    </li>
  );
}
