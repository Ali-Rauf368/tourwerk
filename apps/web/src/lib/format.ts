export const clock = (min: number | null | undefined) =>
  min === null || min === undefined ? '–' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

export const parseClock = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export const km = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} km`);
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} %`);
export const kg = (n: number) => `${Math.round(n).toLocaleString('en-GB')} kg`;

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
export function shiftDay(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const prettyDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Route colours: validated for lightness, chroma and colour-vision separation (stops also carry numbers). */
export const ROUTE_COLORS = ['#0d9488', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#65a30d'];

export const FAIL_LABEL: Record<string, string> = {
  recipient_absent: 'Recipient absent',
  address_not_found: 'Address not found',
  refused: 'Refused',
  damaged: 'Damaged',
};
