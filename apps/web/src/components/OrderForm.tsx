import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { parseClock } from '../lib/format';
import type { Order } from '../lib/types';
import { ErrorNote } from './ui';

export const SERVICE_POSTCODES = ['20095', '20099', '20249', '20259', '20354', '20357', '20457', '20537', '20539', '21107', '22041', '22049', '22081', '22083', '22087', '22089', '22111', '22113', '22297', '22303', '22525', '22605', '22765', '22767'];

interface Props {
  day: string;
  onCreated(order: Order): void;
  onCancel(): void;
}

/** New order form with client-side checks that mirror the API; server field errors are shown inline. */
export function OrderForm({ day, onCreated, onCancel }: Props) {
  const [f, setF] = useState({ customer: '', phone: '', street: '', postcode: '', weightKg: '', parcels: '1', from: '08:00', to: '18:00', deliveryDay: day, note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (f.customer.trim().length < 2) e.customer = 'Enter the customer name';
    if (f.street.trim().length < 3) e.street = 'Enter street and house number';
    if (!/^\d{5}$/.test(f.postcode)) e.postcode = 'Five-digit postcode';
    else if (!SERVICE_POSTCODES.includes(f.postcode)) e.postcode = 'Outside the service area';
    const w = Number(f.weightKg);
    if (!(w > 0 && w <= 1000)) e.weightKg = 'Between 0 and 1000 kg';
    const a = parseClock(f.from);
    const b = parseClock(f.to);
    if (Number.isNaN(a) || Number.isNaN(b)) e.windowEnd = 'Use HH:MM';
    else if (b - a < 30) e.windowEnd = 'The window must be at least 30 minutes';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<Order>('/orders', {
        body: {
          customer: f.customer, phone: f.phone || undefined, street: f.street, postcode: f.postcode, weightKg: Number(f.weightKg), parcels: Number(f.parcels),
          windowStart: parseClock(f.from), windowEnd: parseClock(f.to), deliveryDay: f.deliveryDay, note: f.note || undefined,
        },
      });
      onCreated(order);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string, label: string, input: React.ReactNode) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      {input}
      {errors[name] && <p className="mt-1 text-xs text-rose-600">{errors[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="New order">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        {field('customer', 'Customer', <input id="customer" className="input" value={f.customer} onChange={set('customer')} />)}
        {field('phone', 'Phone (optional)', <input id="phone" className="input" value={f.phone} onChange={set('phone')} />)}
        {field('street', 'Street and number', <input id="street" className="input" value={f.street} onChange={set('street')} />)}
        {field('postcode', 'Postcode', <input id="postcode" className="input" inputMode="numeric" maxLength={5} value={f.postcode} onChange={set('postcode')} />)}
        {field('weightKg', 'Weight (kg)', <input id="weightKg" className="input" inputMode="decimal" value={f.weightKg} onChange={set('weightKg')} />)}
        {field('parcels', 'Parcels', <input id="parcels" className="input" type="number" min={1} max={99} value={f.parcels} onChange={set('parcels')} />)}
        {field('windowStart', 'Window from', <input id="windowStart" className="input" type="time" value={f.from} onChange={set('from')} />)}
        {field('windowEnd', 'Window to', <input id="windowEnd" className="input" type="time" value={f.to} onChange={set('to')} />)}
        {field('deliveryDay', 'Delivery day', <input id="deliveryDay" className="input" type="date" value={f.deliveryDay} onChange={set('deliveryDay')} />)}
        {field('note', 'Note for the driver', <input id="note" className="input" value={f.note} onChange={set('note')} />)}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create order'}</button>
      </div>
    </form>
  );
}
