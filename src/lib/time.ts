/**
 * Timezone helpers built on Intl (no extra dependency).
 * Instants are stored in UTC; calendar dates (order date, payment date) are
 * stored as DATE columns representing the business's local calendar day.
 */

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at `date`, in minutes. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** "2026-10-02T14:30" interpreted as wall-clock time in `timeZone` -> UTC instant. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(guess)) return null;
  // Two passes handle DST transitions correctly.
  let ts = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  ts = guess - zoneOffsetMinutes(new Date(ts), timeZone) * 60000;
  return new Date(ts);
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" in `timeZone` (for datetime-local inputs). */
export function utcToZonedInput(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Calendar date "YYYY-MM-DD" for `date` in `timeZone`. */
export function zonedDateString(date: Date, timeZone: string): string {
  return utcToZonedInput(date, timeZone).slice(0, 10);
}

/** "YYYY-MM-DD" -> Date at UTC midnight (how Prisma represents @db.Date). */
export function dateOnly(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd ? null : d;
}

export function dateOnlyToString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = dateOnly(ymd)!;
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnlyToString(d);
}

/** UTC bounds [start, end) of the local calendar day `ymd` in `timeZone`. */
export function dayBoundsUtc(ymd: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedLocalToUtc(`${ymd}T00:00`, timeZone)!,
    end: zonedLocalToUtc(`${addDaysYmd(ymd, 1)}T00:00`, timeZone)!,
  };
}

/** UTC bounds of the local calendar month containing `now`. */
export function monthBoundsUtc(now: Date, timeZone: string): { start: Date; end: Date; startYmd: string; endYmd: string } {
  const ymd = zonedDateString(now, timeZone);
  const [y, m] = ymd.split("-").map(Number);
  const startYmd = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const endYmd = `${ny}-${String(nm).padStart(2, "0")}-01`;
  return {
    start: zonedLocalToUtc(`${startYmd}T00:00`, timeZone)!,
    end: zonedLocalToUtc(`${endYmd}T00:00`, timeZone)!,
    startYmd,
    endYmd,
  };
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(date: Date, timeZone?: string): string {
  // DATE columns are UTC-midnight values; format them in UTC to avoid day shifts.
  return new Intl.DateTimeFormat("en-IN", { timeZone: timeZone ?? "UTC", dateStyle: "medium" }).format(date);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}
