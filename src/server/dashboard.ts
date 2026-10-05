import { prisma } from "@/lib/db";
import { addDaysYmd, dateOnly, dayBoundsUtc, monthBoundsUtc, zonedDateString } from "@/lib/time";
import { assertNotSuspended, type TenantContext } from "@/server/context";
import { ACTIVE_STATUSES, OPEN_STATUSES } from "@/server/orders";

const orderSummarySelect = {
  id: true,
  number: true,
  status: true,
  fulfillmentAt: true,
  fulfillmentType: true,
  totalMinor: true,
  paidMinor: true,
  paymentStatus: true,
  client: { select: { id: true, name: true, phone: true } },
} as const;

export async function getDashboard(ctx: TenantContext, now = new Date()) {
  assertNotSuspended(ctx);
  const tz = ctx.business.timezone;
  const todayYmd = zonedDateString(now, tz);
  const today = dayBoundsUtc(todayYmd, tz);
  const weekEnd = dayBoundsUtc(addDaysYmd(todayYmd, 7), tz).end;
  const month = monthBoundsUtc(now, tz);
  const b = ctx.businessId;

  const [todayOrders, upcoming, overdue, overdueCount, outstanding, paidToday, paidMonth, createdToday] = await Promise.all([
    prisma.order.findMany({
      where: { businessId: b, status: { not: "CANCELLED" }, fulfillmentAt: { gte: today.start, lt: today.end } },
      select: orderSummarySelect,
      orderBy: { fulfillmentAt: "asc" },
    }),
    prisma.order.findMany({
      where: { businessId: b, status: { in: OPEN_STATUSES }, fulfillmentAt: { gte: today.end, lt: weekEnd } },
      select: orderSummarySelect,
      orderBy: { fulfillmentAt: "asc" },
      take: 10,
    }),
    prisma.order.findMany({
      where: { businessId: b, status: { in: ACTIVE_STATUSES }, fulfillmentAt: { lt: now } },
      select: orderSummarySelect,
      orderBy: { fulfillmentAt: "asc" },
      take: 10,
    }),
    prisma.order.count({ where: { businessId: b, status: { in: ACTIVE_STATUSES }, fulfillmentAt: { lt: now } } }),
    prisma.$queryRaw<{ amount: bigint | null; orders: bigint }[]>`
      SELECT SUM(GREATEST("totalMinor" - "paidMinor", 0))::bigint AS amount,
             COUNT(*) FILTER (WHERE "totalMinor" > "paidMinor")::bigint AS orders
      FROM "Order" WHERE "businessId" = ${b} AND "status" <> 'CANCELLED'`,
    netCollected(b, todayYmd, todayYmd),
    netCollected(b, month.startYmd, addDaysYmd(month.endYmd, -1)),
    prisma.order.count({ where: { businessId: b, createdAt: { gte: today.start, lt: today.end } } }),
  ]);

  const topDebtors = await prisma.$queryRaw<{ id: string; name: string; amount: bigint }[]>`
    SELECT c."id", c."name", SUM(GREATEST(o."totalMinor" - o."paidMinor", 0))::bigint AS amount
    FROM "Order" o JOIN "Client" c ON c."id" = o."clientId" AND c."businessId" = o."businessId"
    WHERE o."businessId" = ${b} AND o."status" <> 'CANCELLED' AND o."totalMinor" > o."paidMinor"
    GROUP BY c."id", c."name" ORDER BY amount DESC LIMIT 5`;

  return {
    todayYmd,
    todayOrders,
    createdToday,
    upcoming,
    overdue,
    overdueCount,
    outstandingMinor: Number(outstanding[0]?.amount ?? 0),
    outstandingOrders: Number(outstanding[0]?.orders ?? 0),
    collectedTodayMinor: paidToday,
    collectedMonthMinor: paidMonth,
    topDebtors: topDebtors.map((d) => ({ ...d, amount: Number(d.amount) })),
  };
}

/** Net money received (payments + deposits - refunds) between two local dates, inclusive. */
async function netCollected(businessId: string, fromYmd: string, toYmd: string) {
  const rows = await prisma.payment.groupBy({
    by: ["kind"],
    where: { businessId, voidedAt: null, paidOn: { gte: dateOnly(fromYmd)!, lte: dateOnly(toYmd)! } },
    _sum: { amountMinor: true },
  });
  return rows.reduce((s, r) => s + (r.kind === "REFUND" ? -1 : 1) * (r._sum.amountMinor ?? 0), 0);
}
