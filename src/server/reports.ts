import { prisma } from "@/lib/db";
import { addDaysYmd, dateOnly, dayBoundsUtc, zonedDateString } from "@/lib/time";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/enums";
import { assertNotSuspended, type TenantContext } from "@/server/context";

/**
 * Sales and payment reports for one day, week (Monday-Sunday) or month, in
 * the business's calendar.
 * - Sales: value of orders by order date, excluding drafts (quotes) and cancelled orders.
 * - Collected: deposits + payments by payment date, excluding voided rows.
 * - Refunds are reported separately; net collected = collected - refunds.
 */
export type ReportPeriod = "day" | "week" | "month";
export const REPORT_PERIODS: ReportPeriod[] = ["day", "week", "month"];

/** How many buckets the trend chart shows, ending with the selected period. */
const TREND_BUCKETS: Record<ReportPeriod, number> = { day: 14, week: 12, month: 12 };

interface Range {
  startYmd: string;
  endYmd: string; // inclusive
}

function weekday(ymd: string) {
  return dateOnly(ymd)!.getUTCDay(); // 0 = Sunday
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

/** The period containing `ymd`. */
export function periodRange(period: ReportPeriod, ymd: string): Range {
  if (period === "day") return { startYmd: ymd, endYmd: ymd };
  if (period === "week") {
    const startYmd = addDaysYmd(ymd, -((weekday(ymd) + 6) % 7));
    return { startYmd, endYmd: addDaysYmd(startYmd, 6) };
  }
  const startYmd = `${ymd.slice(0, 7)}-01`;
  return { startYmd, endYmd: addDaysYmd(addMonthsYmd(startYmd, 1), -1) };
}

/** The period `n` periods before (negative) or after the one containing `ymd`. */
export function shiftPeriod(period: ReportPeriod, ymd: string, n: number): Range {
  const r = periodRange(period, ymd);
  if (period === "day") return periodRange(period, addDaysYmd(r.startYmd, n));
  if (period === "week") return periodRange(period, addDaysYmd(r.startYmd, 7 * n));
  return periodRange(period, addMonthsYmd(r.startYmd, n));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(ymd: string) {
  return `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
}
function monthLabel(ymd: string) {
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`;
}

export function rangeLabel(period: ReportPeriod, r: Range) {
  if (period === "day") return `${shortDate(r.startYmd)} ${r.startYmd.slice(0, 4)}`;
  if (period === "week") return `${shortDate(r.startYmd)} – ${shortDate(r.endYmd)} ${r.endYmd.slice(0, 4)}`;
  return monthLabel(r.startYmd);
}

function bucketLabel(period: ReportPeriod, r: Range) {
  if (period === "month") return `${MONTHS[Number(r.startYmd.slice(5, 7)) - 1]} ${r.startYmd.slice(2, 4)}`;
  return shortDate(r.startYmd);
}

interface Totals {
  salesMinor: number;
  orders: number;
  collectedMinor: number;
  refundedMinor: number;
}
const emptyTotals = (): Totals => ({ salesMinor: 0, orders: 0, collectedMinor: 0, refundedMinor: 0 });

export async function getSalesReport(ctx: TenantContext, period: ReportPeriod, offset = 0, now = new Date()) {
  assertNotSuspended(ctx);
  const b = ctx.businessId;
  const tz = ctx.business.timezone;
  const todayYmd = zonedDateString(now, tz);
  const safeOffset = Math.min(0, Math.max(-520, Math.trunc(offset) || 0));
  const current = shiftPeriod(period, todayYmd, safeOffset);
  const previous = shiftPeriod(period, current.startYmd, -1);
  const buckets = Array.from({ length: TREND_BUCKETS[period] }, (_, i) => shiftPeriod(period, current.startYmd, i - TREND_BUCKETS[period] + 1));
  const windowStart = buckets[0].startYmd;
  const windowEnd = current.endYmd;

  const utcStart = (r: Range) => dayBoundsUtc(r.startYmd, tz).start;
  const utcEnd = (r: Range) => dayBoundsUtc(r.endYmd, tz).end;

  const [salesDaily, payDaily, methods, products, clients, statuses, newClients, newClientsPrev] = await Promise.all([
    prisma.$queryRaw<{ d: string; sales: bigint; orders: bigint }[]>`
      SELECT "orderDate"::text AS d, SUM("totalMinor")::bigint AS sales, COUNT(*)::bigint AS orders
      FROM "Order"
      WHERE "businessId" = ${b} AND "status" NOT IN ('DRAFT', 'CANCELLED')
        AND "orderDate" BETWEEN ${windowStart}::date AND ${windowEnd}::date
      GROUP BY 1`,
    prisma.$queryRaw<{ d: string; received: bigint; refunded: bigint }[]>`
      SELECT "paidOn"::text AS d,
             SUM(CASE WHEN "kind" = 'REFUND' THEN 0 ELSE "amountMinor" END)::bigint AS received,
             SUM(CASE WHEN "kind" = 'REFUND' THEN "amountMinor" ELSE 0 END)::bigint AS refunded
      FROM "Payment"
      WHERE "businessId" = ${b} AND "voidedAt" IS NULL
        AND "paidOn" BETWEEN ${windowStart}::date AND ${windowEnd}::date
      GROUP BY 1`,
    prisma.payment.groupBy({
      by: ["method"],
      where: { businessId: b, voidedAt: null, kind: { not: "REFUND" }, paidOn: { gte: dateOnly(current.startYmd)!, lte: dateOnly(current.endYmd)! } },
      _sum: { amountMinor: true },
      _count: true,
    }),
    prisma.$queryRaw<{ name: string; qty: bigint; revenue: bigint }[]>`
      SELECT i."description" AS name, SUM(i."quantityMilli")::bigint AS qty, SUM(i."lineTotalMinor")::bigint AS revenue
      FROM "OrderItem" i JOIN "Order" o ON o."id" = i."orderId" AND o."businessId" = i."businessId"
      WHERE o."businessId" = ${b} AND o."status" NOT IN ('DRAFT', 'CANCELLED')
        AND o."orderDate" BETWEEN ${current.startYmd}::date AND ${current.endYmd}::date
      GROUP BY i."description" ORDER BY revenue DESC LIMIT 6`,
    prisma.$queryRaw<{ id: string; name: string; sales: bigint; orders: bigint }[]>`
      SELECT c."id", c."name", SUM(o."totalMinor")::bigint AS sales, COUNT(*)::bigint AS orders
      FROM "Order" o JOIN "Client" c ON c."id" = o."clientId" AND c."businessId" = o."businessId"
      WHERE o."businessId" = ${b} AND o."status" NOT IN ('DRAFT', 'CANCELLED')
        AND o."orderDate" BETWEEN ${current.startYmd}::date AND ${current.endYmd}::date
      GROUP BY c."id", c."name" ORDER BY sales DESC LIMIT 5`,
    prisma.order.groupBy({
      by: ["status"],
      where: { businessId: b, orderDate: { gte: dateOnly(current.startYmd)!, lte: dateOnly(current.endYmd)! } },
      _count: true,
    }),
    prisma.client.count({ where: { businessId: b, createdAt: { gte: utcStart(current), lt: utcEnd(current) } } }),
    prisma.client.count({ where: { businessId: b, createdAt: { gte: utcStart(previous), lt: utcEnd(previous) } } }),
  ]);

  // Aggregate daily rows into buckets; the current and previous periods are buckets too.
  const totalsFor = (r: Range): Totals => {
    const t = emptyTotals();
    for (const row of salesDaily) if (row.d >= r.startYmd && row.d <= r.endYmd) {
      t.salesMinor += Number(row.sales);
      t.orders += Number(row.orders);
    }
    for (const row of payDaily) if (row.d >= r.startYmd && row.d <= r.endYmd) {
      t.collectedMinor += Number(row.received);
      t.refundedMinor += Number(row.refunded);
    }
    return t;
  };
  const cur = totalsFor(current);
  const prev = totalsFor(previous);

  return {
    period,
    offset: safeOffset,
    todayYmd,
    current: { ...current, label: rangeLabel(period, current) },
    previous: { ...previous, label: rangeLabel(period, previous) },
    totals: { ...cur, newClients },
    previousTotals: { ...prev, newClients: newClientsPrev },
    trend: buckets.map((r) => {
      const t = totalsFor(r);
      return { label: bucketLabel(period, r), rangeLabel: rangeLabel(period, r), salesMinor: t.salesMinor, collectedMinor: t.collectedMinor - t.refundedMinor };
    }),
    methods: methods
      .map((m) => ({ method: m.method as PaymentMethod, amountMinor: m._sum.amountMinor ?? 0, count: m._count }))
      .sort((a, z) => z.amountMinor - a.amountMinor),
    products: products.map((p) => ({ name: p.name, quantityMilli: Number(p.qty), revenueMinor: Number(p.revenue) })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, salesMinor: Number(c.sales), orders: Number(c.orders) })),
    statuses: statuses.map((s) => ({ status: s.status as OrderStatus, count: s._count })),
  };
}

export type SalesReport = Awaited<ReturnType<typeof getSalesReport>>;
