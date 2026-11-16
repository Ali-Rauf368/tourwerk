import type { ReactNode } from 'react';
import type { OrderStatus } from '../lib/types';

const STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  PLANNED: 'bg-sky-50 text-sky-700',
  OUT_FOR_DELIVERY: 'bg-amber-50 text-amber-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  DELIVERED: 'bg-emerald-50 text-emerald-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
  PENDING: 'bg-slate-100 text-slate-600',
  ARRIVED: 'bg-sky-50 text-sky-700',
};
const STATUS_LABEL: Record<string, string> = { OUT_FOR_DELIVERY: 'Out for delivery', IN_PROGRESS: 'In progress' };

export function StatusBadge({ status }: { status: OrderStatus | string }) {
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-slate-100'}`}>{label}</span>;
}

export function Kpi({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</div>;
}

export function LoadBar({ value, color = '#0f766e' }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

export function DayPicker({ value, onChange }: { value: string; onChange(day: string): void }) {
  return <input type="date" aria-label="Day" className="input w-auto" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}
