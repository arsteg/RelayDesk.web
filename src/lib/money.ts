/**
 * Money helpers. All amounts are integers in the currency's minor unit
 * (paise for INR, cents for USD, yen for JPY). Never use floats for storage.
 */

const digitsCache = new Map<string, number>();

export function minorDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  digitsCache.set(currency, digits);
  return digits;
}

/**
 * Parse user input such as "1,250.50" into minor units without float maths.
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseMoneyToMinor(input: string | null | undefined, currency: string): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[,\s₹$€£]/g, "").trim();
  if (cleaned === "") return null;
  const digits = minorDigits(currency);
  const re = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$|^\\.\\d{1,${digits}}$`);
  if (!re.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.split(".");
  const minor = Number(whole || "0") * 10 ** digits + Number((frac + "0".repeat(digits)).slice(0, digits) || "0");
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

/** Minor units -> plain decimal string for form inputs, e.g. 125050 -> "1250.50". */
export function minorToInput(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = String(abs % 10 ** digits).padStart(digits, "0");
  return `${sign}${whole}.${frac}`;
}

export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  const digits = minorDigits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return `${currency} ${minorToInput(minor, currency)}`;
  }
}

/** Quantities are stored as integer thousandths so "1.5" kg is exact. */
export function parseQuantityToMilli(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const milli = Number(whole) * 1000 + Number((frac + "000").slice(0, 3));
  return Number.isSafeInteger(milli) ? milli : null;
}

export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = milli % 1000;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** Percentage string ("5", "18.5") -> basis points (500, 1850). */
export function parsePercentToBps(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const bps = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return bps <= 10000 ? bps : null;
}

export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
