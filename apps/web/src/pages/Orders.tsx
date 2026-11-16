import { useEffect, useState } from 'react';
import { OrderForm } from '../components/OrderForm';
import { DayPicker, ErrorNote, PageHeader, StatusBadge } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { api } from '../lib/api';
import { clock, FAIL_LABEL, prettyDay, today } from '../lib/format';
import type { Order, OrderStatus } from '../lib/types';
import { useApi } from '../lib/useApi';

const FILTERS: (OrderStatus | '')[] = ['', 'NEW', 'PLANNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'];

export function Orders() {
  const [day, setDay] = useState(today);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { version } = useLive();

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => (setQuery(q.trim()), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams({ day, page: String(page), pageSize: '25', ...(status ? { status } : {}), ...(query ? { q: query } : {}) });
  const list = useApi<{ total: number; items: Order[] }>(`/orders?${qs}`, [version]);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));

  /** Opens the recipient's public tracking page (in production the link goes out by SMS/e-mail). */
  async function openTracking(o: Order) {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { path } = await api<{ path: string }>(`/orders/${o.id}/tracking-link`);
      if (tab) tab.location.href = path;
      else window.location.href = path;
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }

  async function cancel(o: Order) {
    setError(null);
    try {
      await api(`/orders/${o.id}/cancel`, { method: 'POST' });
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={`${prettyDay(day)} · ${list.data?.total ?? '…'} orders`}
        actions={
          <>
            <DayPicker value={day} onChange={(d) => (setDay(d), setPage(1))} />
            <button className="btn-primary" onClick={() => setCreating(true)}>New order</button>
          </>
        }
      />
      {creating && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" role="dialog" aria-modal="true" aria-labelledby="new-order-title">
          <div className="card w-full max-w-2xl p-6">
            <h2 id="new-order-title" className="mb-4 text-lg font-semibold">New order</h2>
            <OrderForm day={day} onCancel={() => setCreating(false)} onCreated={(o) => (setCreating(false), setDay(o.deliveryDay.slice(0, 10)), list.reload())} />
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search number, customer, street, postcode" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((s) => (
            <button key={s || 'all'} className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`} onClick={() => (setStatus(s), setPage(1))}>
              {s ? s.replaceAll('_', ' ').toLowerCase() : 'all'}
            </button>
          ))}
        </div>
      </div>
      {(error || list.error) && <div className="mb-3"><ErrorNote>{error ?? list.error}</ErrorNote></div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr><th className="th">Order</th><th className="th">Customer</th><th className="th">Address</th><th className="th">Window</th><th className="th text-right">Weight</th><th className="th">Tour</th><th className="th">Status</th><th className="th" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.items.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td"><div className="font-mono text-xs">{o.number}</div><div className="text-[11px] text-slate-400">{o.source.toLowerCase()}</div></td>
                <td className="td">{o.customer}</td>
                <td className="td text-slate-600">{o.street}, {o.postcode}</td>
                <td className="td tabular-nums">{clock(o.windowStart)}–{clock(o.windowEnd)}</td>
                <td className="td text-right tabular-nums">{o.weightKg} kg</td>
                <td className="td text-xs text-slate-600">{o.stop ? <>{o.stop.tour.vehicle.plate} · #{o.stop.seq} · {clock(o.stop.completedMin ?? o.stop.etaMin)}</> : '–'}</td>
                <td className="td"><StatusBadge status={o.status} />{o.failReason && <div className="text-[11px] text-rose-600">{FAIL_LABEL[o.failReason] ?? o.failReason}</div>}</td>
                <td className="td whitespace-nowrap text-right">
                  {o.status !== 'CANCELLED' && <button className="mr-3 text-xs text-brand-700 hover:underline" onClick={() => openTracking(o)}>Tracking</button>}
                  {o.status === 'NEW' && <button className="text-xs text-slate-500 hover:text-rose-700" onClick={() => cancel(o)}>Cancel</button>}
                </td>
              </tr>
            ))}
            {list.data && !list.data.items.length && <tr><td className="td py-10 text-center text-slate-500" colSpan={8}>No orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span className="text-slate-500">Page {page} of {pages}</span>
        <button className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </>
  );
}
