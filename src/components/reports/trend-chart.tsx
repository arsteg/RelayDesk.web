"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, minorDigits } from "@/lib/money";

export interface TrendPoint {
  label: string;
  rangeLabel: string;
  salesMinor: number;
  collectedMinor: number;
}

// Categorical slots 1-2 of the validated palette (checked against the white card surface).
const SERIES = [
  { key: "salesMinor", name: "Sales", color: "#2a78d6" },
  { key: "collectedMinor", name: "Collected (net)", color: "#eb6834" },
] as const;

const W = 720;
const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const BAR = 16; // <= 24px, never fills the band
const GAP = 2; // surface gap between the two bars of a group

/** Smallest "nice" tick step (1, 2, 2.5, 5 × 10^n) whose 4 ticks cover v. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= raw)! * mag;
  return step * 4;
}

/** Column with a 4px rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function TrendChart({ points, currency }: { points: TrendPoint[]; currency: string }) {
  const minorUnit = 10 ** minorDigits(currency);
  const [active, setActive] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // On narrow screens the chart scrolls sideways: start at the latest period.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [points]);
  const compact = new Intl.NumberFormat("en-IN", { notation: "compact", style: "currency", currency, maximumFractionDigits: 1 });
  const max = niceMax(Math.max(...points.flatMap((p) => [p.salesMinor, Math.max(p.collectedMinor, 0)])));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / points.length;
  const y = (v: number) => PAD.top + plotH - (Math.max(v, 0) / max) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const labelEvery = points.length > 12 ? 2 : 1;
  const empty = points.every((p) => p.salesMinor === 0 && p.collectedMinor === 0);
  const a = active === null ? null : points[active];

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-stone-600" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
      </ul>
      <div ref={scroller} className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[560px]" role="img" aria-label="Sales and net collections per period" onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c3c2b7" : "#e7e5e4"} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-stone-500 text-[11px] tabular-nums">
                {compact.format(t / minorUnit)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = PAD.left + band * i + band / 2;
            return (
              <g key={i}>
                {active === i && <rect x={PAD.left + band * i + 1} y={PAD.top} width={band - 2} height={plotH} rx={4} className="fill-stone-100" />}
                {SERIES.map((s, si) => {
                  const v = Math.max(p[s.key], 0);
                  const h = (v / max) * plotH;
                  const x = cx - BAR - GAP / 2 + si * (BAR + GAP);
                  return h > 0 ? <path key={s.key} d={columnPath(x, y(v), BAR, h)} fill={s.color} /> : null;
                })}
                {i % labelEvery === (points.length - 1) % labelEvery && (
                  <text x={cx} y={H - 8} textAnchor="middle" className="fill-stone-500 text-[11px]">{p.label}</text>
                )}
                {/* Hit target: the whole band, bigger than the marks. */}
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${p.rangeLabel}: sales ${formatMoney(p.salesMinor, currency)}, collected ${formatMoney(p.collectedMinor, currency)}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                />
              </g>
            );
          })}
        </svg>
        {empty && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-stone-500">No sales or payments in this range yet.</p>}
        {a && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-stone-200"
            style={active! < points.length / 2 ? { left: `${((PAD.left + band * (active! + 1)) / W) * 100}%` } : { right: `${((W - PAD.left - band * active!) / W) * 100}%` }}
          >
            <p className="mb-1 text-stone-500">{a.rangeLabel}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-stone-500">
                  <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                  {s.name}
                </span>
                <strong className="tabular-nums text-stone-900">{formatMoney(a[s.key], currency)}</strong>
              </p>
            ))}
          </div>
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-brand-700 hover:underline">Show as table</summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-stone-500">
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">Sales</th>
              <th className="py-1 text-right font-medium">Collected (net)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i} className="border-t border-stone-100">
                <td className="py-1">{p.rangeLabel}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(p.salesMinor, currency)}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(p.collectedMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
