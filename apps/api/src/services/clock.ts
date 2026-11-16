/** Tourwerk works in the depot's local time (Europe/Berlin), independent of the server's TZ. */
export const SERVICE_TZ = 'Europe/Berlin';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: SERVICE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function parts(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** Local calendar day as YYYY-MM-DD. */
export const localDay = (d = new Date()) => parts(d).day;
/** Minutes after local midnight. */
export const localMinute = (d = new Date()) => parts(d).minute;
/** A YYYY-MM-DD day as the Date Prisma stores in a @db.Date column. */
export const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dayString = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => dayString(new Date(dayDate(day).getTime() + n * 86_400_000));
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
