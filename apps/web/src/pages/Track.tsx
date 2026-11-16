import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { RouteMap } from '../components/RouteMap';
import { api, ApiError } from '../lib/api';
import { clock, prettyDay } from '../lib/format';
import type { Tracking } from '../lib/types';

const REFRESH_MS = 10_000;
const STEPS = [
  { key: 'PLANNED', label: 'Scheduled' },
  { key: 'OUT_FOR_DELIVERY', label: 'On the way' },
  { key: 'DONE', label: 'Delivered' },
] as const;
const FAIL_TEXT: Record<string, string> = {
  recipient_absent: 'We could not reach you at the address.',
  address_not_found: 'The driver could not find the address.',
  refused: 'The delivery was refused.',
  damaged: 'The parcel was damaged and returned to the depot.',
};

function stepIndex(status: Tracking['status']) {
  if (status === 'DELIVERED' || status === 'FAILED') return 2;
  if (status === 'OUT_FOR_DELIVERY') return 1;
  if (status === 'PLANNED') return 0;
  return -1;
}

/** Public delivery tracking for recipients (no login; the link itself is signed). */
export function Track() {
  const { token = '' } = useParams();
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const t = await api<Tracking>(`/track/${encodeURIComponent(token)}`);
        if (!alive) return;
        setData(t);
        setError(null);
        setUpdated(new Date());
        if (t.status === 'DELIVERED' || t.status === 'FAILED' || t.status === 'CANCELLED') return; // final: stop polling
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError && e.status === 404 ? 'This tracking link is not valid.' : 'Tracking is temporarily unavailable.');
        if (e instanceof ApiError && e.status === 404) return;
      }
      timer = setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token]);

  const step = data ? stepIndex(data.status) : -1;
  const arrival = data?.eta ?? data?.plannedEta;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <main className="mx-auto max-w-lg space-y-4">
        <header className="flex items-center gap-2 text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">T</span>
          <span className="font-semibold">Tourwerk delivery</span>
        </header>

        {error && !data && <div className="card p-6 text-center text-slate-600" role="alert">{error}</div>}
        {!data && !error && <div className="card p-6 text-center text-slate-500">Loading…</div>}

        {data && (
          <>
            <section className="card p-5">
              <p className="font-mono text-xs text-slate-500">{data.number} · {data.parcels} parcel{data.parcels > 1 ? 's' : ''}</p>
              <h1 className="mt-1 text-xl font-semibold">
                {data.status === 'DELIVERED' && `Delivered at ${clock(data.completedMin)}`}
                {data.status === 'FAILED' && 'Delivery attempt failed'}
                {data.status === 'CANCELLED' && 'This delivery was cancelled'}
                {data.status === 'OUT_FOR_DELIVERY' && (data.stopsBefore === 0 ? 'Your parcel is next!' : 'Your parcel is on the way')}
                {(data.status === 'PLANNED' || data.status === 'NEW') && `Arriving ${prettyDay(data.deliveryDay)}`}
              </h1>
              <p className="text-sm text-slate-600">{data.street}, {data.postcode} {data.city}</p>

              {arrival && (data.status === 'PLANNED' || data.status === 'OUT_FOR_DELIVERY') && (
                <div className="mt-4 rounded-xl bg-brand-50 p-4">
                  <div className="text-xs uppercase tracking-wide text-brand-700">{data.eta ? 'Expected arrival (live)' : 'Planned arrival'}</div>
                  <div className="text-3xl font-semibold tabular-nums text-slate-900" data-testid="eta">{clock(arrival.start)} – {clock(arrival.end)}</div>
                  {data.stopsBefore !== null && data.stopsBefore > 0 && (
                    <div className="mt-1 text-sm text-slate-600">{data.stopsBefore} stop{data.stopsBefore > 1 ? 's' : ''} before yours</div>
                  )}
                  {data.eta?.risk === 'late' && <div className="mt-1 text-sm text-amber-800">Running a little behind. Thank you for your patience.</div>}
                </div>
              )}
              {data.status === 'FAILED' && (
                <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{FAIL_TEXT[data.failReason ?? ''] ?? 'The parcel could not be delivered.'} We will contact you about a new delivery date.</p>
              )}

              {step >= 0 && (
                <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Delivery progress">
                  {STEPS.map((s, i) => (
                    <li key={s.key} className="text-center" aria-current={i === step ? 'step' : undefined}>
                      <div className={`h-1.5 rounded-full ${i <= step ? (data.status === 'FAILED' && i === 2 ? 'bg-rose-500' : 'bg-brand-600') : 'bg-slate-200'}`} />
                      <div className={`mt-1.5 text-xs ${i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{i === 2 && data.status === 'FAILED' ? 'Not delivered' : s.label}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {data.status === 'OUT_FOR_DELIVERY' && (
              <section className="card overflow-hidden p-0">
                <RouteMap
                  depot={data.depot}
                  height={300}
                  loose={[{ id: 'home', lat: data.destination.lat, lng: data.destination.lng, title: 'Your address' }]}
                  vehicles={data.van ? [{ id: 'van', ...data.van, color: '#0f766e', label: data.vehicle?.plate ?? 'Van' }] : []}
                />
                <p className="px-4 py-3 text-xs text-slate-500">
                  {data.van ? `${data.driver ?? 'Your driver'} is nearby in ${data.vehicle?.electric ? 'an electric van' : 'van'} ${data.vehicle?.plate}.` : 'The van appears on the map once you are among the next stops.'}
                </p>
              </section>
            )}

            <p className="text-center text-xs text-slate-400">
              {updated && `Updated ${updated.toLocaleTimeString('en-GB')}`}
              {error && ` · ${error}`}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
