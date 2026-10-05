import Link from "next/link";
import type { ReactNode } from "react";
import type { ReportPeriod } from "@/server/reports";

const PERIOD_LABEL: Record<ReportPeriod, string> = { day: "Daily", week: "Weekly", month: "Monthly" };
const PERIOD_NOUN: Record<ReportPeriod, string> = { day: "day", week: "week", month: "month" };

const href = (period: ReportPeriod, offset: number) => `/app?period=${period}${offset ? `&offset=${offset}` : ""}`;

/** Daily / weekly / monthly switch plus previous / next navigation. */
export function PeriodNav({ period, offset, label }: { period: ReportPeriod; offset: number; label: string }) {
  const step = "rounded-lg px-2.5 py-1.5 text-sm text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav aria-label="Report period" className="inline-flex rounded-lg bg-stone-100 p-0.5">
        {(Object.keys(PERIOD_LABEL) as ReportPeriod[]).map((p) => (
          <Link
            key={p}
            href={href(p, 0)}
            aria-current={p === period ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${p === period ? "bg-white text-stone-900 shadow-xs" : "text-stone-600 hover:text-stone-900"}`}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        <Link href={href(period, offset - 1)} className={step} aria-label={`Previous ${PERIOD_NOUN[period]}`}>‹</Link>
        <span className="min-w-36 text-center text-sm font-medium text-stone-800">{label}</span>
        {offset < 0 ? (
          <Link href={href(period, offset + 1)} className={step} aria-label={`Next ${PERIOD_NOUN[period]}`}>›</Link>
        ) : (
          <span className={`${step} cursor-not-allowed opacity-40`} aria-hidden>›</span>
        )}
        {offset < 0 && <Link href={href(period, 0)} className="text-sm text-brand-700 hover:underline">Current</Link>}
      </div>
    </div>
  );
}

/** "last week" for the current period, "previous week" when browsing back. */
export function compareLabel(period: ReportPeriod, offset: number) {
  if (offset < 0) return `previous ${PERIOD_NOUN[period]}`;
  return period === "day" ? "yesterday" : `last ${PERIOD_NOUN[period]}`;
}

/**
 * Figure tile with change vs the previous period. Direction is shown by arrow
 * and words, not colour alone; the exact previous range and value are in the
 * tooltip.
 */
export function KpiTile({
  label,
  value,
  current,
  previous,
  previousLabel,
  previousRange,
  upIsGood = true,
  format,
}: {
  label: string;
  value: ReactNode;
  current: number;
  previous: number;
  previousLabel: string;
  previousRange: string;
  upIsGood?: boolean;
  format: (n: number) => string;
}) {
  let delta: ReactNode = <span className="text-stone-500">No change vs {previousLabel}</span>;
  if (current !== previous) {
    const up = current > previous;
    const good = up === upIsGood;
    const pct = previous ? `${Math.round((Math.abs(current - previous) / Math.abs(previous)) * 100)}%` : null;
    delta = (
      <span className={good ? "text-emerald-700" : "text-red-700"}>
        <span aria-hidden>{up ? "▲" : "▼"}</span> {up ? "Up" : "Down"} {pct ?? format(Math.abs(current - previous))}
        <span className="text-stone-500"> vs {previousLabel}</span>
      </span>
    );
  }
  return (
    <div className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-stone-200">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
      <p className="mt-1 text-xs" title={`${previousRange}: ${format(previous)}`}>{delta}</p>
    </div>
  );
}

/** Ranked horizontal bars (one series, one colour), value at the bar's end. */
export function BarList({ rows, empty }: { rows: { key: string; label: ReactNode; value: number; display: string; sub?: string }[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-stone-500">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-stone-800">{r.label}</span>
            <span className="shrink-0 tabular-nums text-stone-900">
              {r.display}
              {r.sub && <span className="ml-1 text-xs text-stone-500">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-r-[4px] bg-stone-100">
            <div className="h-2.5 rounded-r-[4px]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: "#2a78d6" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
