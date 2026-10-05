import Link from "next/link";
import { Alert, ButtonLink, Card, EmptyState, Stat } from "@/components/ui";
import { OrderLink, OrderStatusBadge, PaymentStatusBadge } from "@/components/order-bits";
import { BarList, compareLabel, KpiTile, PeriodNav } from "@/components/reports/report-parts";
import { TrendChart } from "@/components/reports/trend-chart";
import { requireTenantPage } from "@/lib/auth/current";
import { PAYMENT_METHOD } from "@/lib/labels";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { getDashboard } from "@/server/dashboard";
import { ORDER_STATUSES } from "@/server/orders";
import { getSalesReport, REPORT_PERIODS, type ReportPeriod } from "@/server/reports";
import { sp, type SearchParams } from "@/lib/page";

export const metadata = { title: "Dashboard" };

type DashOrder = Awaited<ReturnType<typeof getDashboard>>["todayOrders"][number];

function OrderList({ orders, prefix, currency, tz, empty }: { orders: DashOrder[]; prefix: string; currency: string; tz: string; empty: string }) {
  if (!orders.length) return <p className="py-4 text-center text-sm text-stone-500">{empty}</p>;
  return (
    <ul className="divide-y divide-stone-100">
      {orders.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <div className="min-w-0">
            <p className="text-sm">
              <OrderLink id={o.id} number={o.number} prefix={prefix} /> · <Link href={`/app/clients/${o.client.id}`} className="hover:underline">{o.client.name}</Link>
            </p>
            <p className="text-xs text-stone-500">
              {formatDateTime(o.fulfillmentAt, tz)} · {o.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums">{formatMoney(o.totalMinor, currency)}</span>
            <OrderStatusBadge status={o.status} />
            <PaymentStatusBadge status={o.paymentStatus} orderStatus={o.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage();
  const params = await searchParams;
  const period = REPORT_PERIODS.find((p) => p === sp(params, "period")) ?? ("day" as ReportPeriod);
  const [d, r] = await Promise.all([getDashboard(ctx), getSalesReport(ctx, period, Number(sp(params, "offset") ?? 0))]);
  const cur = ctx.business.currency;
  const tz = ctx.business.timezone;
  const prefix = ctx.business.invoicePrefix;
  const writable = ctx.access.level === "full";
  const money = (minor: number) => formatMoney(minor, cur);
  const avg = (t: { salesMinor: number; orders: number }) => (t.orders ? Math.round(t.salesMinor / t.orders) : 0);
  const vs = compareLabel(r.period, r.offset);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-stone-500">{new Intl.DateTimeFormat("en-IN", { timeZone: tz, dateStyle: "full" }).format(new Date())}</p>
        </div>
        {writable && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/app/orders/new">New order</ButtonLink>
            <ButtonLink href="/app/clients/new" variant="secondary">New client</ButtonLink>
            <ButtonLink href="/app/payments/new" variant="secondary">Record payment</ButtonLink>
          </div>
        )}
      </div>
      {params.denied && <Alert tone="amber">You don&apos;t have permission to open that page.</Alert>}

      <h2 className="sr-only">Right now</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due today" value={d.todayOrders.length} hint={`${d.createdToday} new orders taken today`} href={`/app/orders?from=${d.todayYmd}&to=${d.todayYmd}`} />
        <Stat label="Overdue" value={d.overdueCount} tone={d.overdueCount ? "red" : undefined} hint="Confirmed work past its fulfilment time" href="/app/orders?status=OVERDUE" />
        <Stat label="Outstanding" value={formatMoney(d.outstandingMinor, cur)} hint={`${d.outstandingOrders} orders with a balance`} href="/app/orders?paymentStatus=DUE" />
        <Stat label="Collected today" value={formatMoney(d.collectedTodayMinor, cur)} tone="green" hint={`${formatMoney(d.collectedMonthMinor, cur)} this month`} href="/app/payments" />
      </div>

      <section aria-labelledby="report-heading" className="space-y-4 border-t border-stone-200 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="report-heading" className="text-lg font-semibold">Sales &amp; payments report</h2>
            <p className="text-xs text-stone-500">Sales count confirmed orders by order date (drafts and cancelled orders excluded). Collections count payments by payment date.</p>
          </div>
          <PeriodNav period={r.period} offset={r.offset} label={r.current.label} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile label="Sales" value={money(r.totals.salesMinor)} current={r.totals.salesMinor} previous={r.previousTotals.salesMinor} previousLabel={vs} previousRange={r.previous.label} format={money} />
          <KpiTile label="Collected (net)" value={money(r.totals.collectedMinor - r.totals.refundedMinor)} current={r.totals.collectedMinor - r.totals.refundedMinor} previous={r.previousTotals.collectedMinor - r.previousTotals.refundedMinor} previousLabel={vs} previousRange={r.previous.label} format={money} />
          <KpiTile label="Orders" value={r.totals.orders} current={r.totals.orders} previous={r.previousTotals.orders} previousLabel={vs} previousRange={r.previous.label} format={String} />
          <KpiTile label="Average order" value={money(avg(r.totals))} current={avg(r.totals)} previous={avg(r.previousTotals)} previousLabel={vs} previousRange={r.previous.label} format={money} />
          <KpiTile label="Refunds" value={money(r.totals.refundedMinor)} current={r.totals.refundedMinor} previous={r.previousTotals.refundedMinor} previousLabel={vs} previousRange={r.previous.label} upIsGood={false} format={money} />
          <KpiTile label="New clients" value={r.totals.newClients} current={r.totals.newClients} previous={r.previousTotals.newClients} previousLabel={vs} previousRange={r.previous.label} format={String} />
        </div>

        <Card title={`Sales vs collections - last ${r.trend.length} ${r.period === "day" ? "days" : r.period === "week" ? "weeks" : "months"}`}>
          <TrendChart points={r.trend} currency={cur} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Payments by method - ${r.current.label}`}>
            <BarList
              empty="No payments received in this period."
              rows={r.methods.map((m) => ({ key: m.method, label: PAYMENT_METHOD[m.method], value: m.amountMinor, display: money(m.amountMinor), sub: `${m.count} payment${m.count === 1 ? "" : "s"}` }))}
            />
            {r.totals.refundedMinor > 0 && <p className="mt-3 text-xs text-stone-500">Refunds paid out: {money(r.totals.refundedMinor)}</p>}
          </Card>
          <Card title={`Best-selling items - ${r.current.label}`}>
            <BarList
              empty="No items sold in this period."
              rows={r.products.map((p) => ({ key: p.name, label: p.name, value: p.revenueMinor, display: money(p.revenueMinor), sub: `× ${formatQuantity(p.quantityMilli)}` }))}
            />
          </Card>
          <Card title={`Top clients - ${r.current.label}`}>
            <BarList
              empty="No sales in this period."
              rows={r.clients.map((c) => ({ key: c.id, label: <Link href={`/app/clients/${c.id}`} className="hover:underline">{c.name}</Link>, value: c.salesMinor, display: money(c.salesMinor), sub: `${c.orders} order${c.orders === 1 ? "" : "s"}` }))}
            />
          </Card>
          <Card title={`Orders by status - ${r.current.label}`}>
            {r.statuses.length ? (
              <ul className="divide-y divide-stone-100">
                {ORDER_STATUSES.filter((s) => r.statuses.some((x) => x.status === s)).map((s) => (
                  <li key={s} className="flex items-center justify-between py-2 text-sm">
                    <OrderStatusBadge status={s} />
                    <span className="tabular-nums">{r.statuses.find((x) => x.status === s)!.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-stone-500">No orders dated in this period.</p>
            )}
            <p className="mt-2 text-xs text-stone-500">By order date. Includes drafts and cancelled orders, which are left out of sales.</p>
          </Card>
        </div>
      </section>

      <div className="grid gap-6 border-t border-stone-200 pt-6 lg:grid-cols-2">
        <Card title="Today's orders" actions={<Link href={`/app/orders?from=${d.todayYmd}&to=${d.todayYmd}`} className="text-xs text-brand-700 hover:underline">View all</Link>}>
          <OrderList orders={d.todayOrders} prefix={prefix} currency={cur} tz={tz} empty="Nothing due today." />
        </Card>
        <Card title="Overdue" actions={<Link href="/app/orders?status=OVERDUE" className="text-xs text-brand-700 hover:underline">View all</Link>}>
          <OrderList orders={d.overdue} prefix={prefix} currency={cur} tz={tz} empty="No overdue orders. 🎉" />
        </Card>
        <Card title="Upcoming (next 7 days)" actions={<Link href="/app/orders?status=OPEN&sort=fulfillment_asc" className="text-xs text-brand-700 hover:underline">View all</Link>}>
          <OrderList orders={d.upcoming} prefix={prefix} currency={cur} tz={tz} empty="No upcoming orders this week." />
        </Card>
        <Card title="Largest outstanding balances">
          {d.topDebtors.length ? (
            <ul className="divide-y divide-stone-100">
              {d.topDebtors.map((c) => (
                <li key={c.id} className="flex justify-between py-2.5 text-sm">
                  <Link href={`/app/clients/${c.id}`} className="hover:underline">{c.name}</Link>
                  <span className="tabular-nums text-red-700">{formatMoney(c.amount, cur)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-stone-500">All balances are settled.</p>
          )}
        </Card>
      </div>
      {d.todayOrders.length === 0 && d.upcoming.length === 0 && d.overdueCount === 0 && writable && (
        <EmptyState title="Ready for your first order?" description="Add a client, then create an order with items, a pickup or delivery time and any deposit." action={<ButtonLink href="/app/orders/new">Create an order</ButtonLink>} />
      )}
    </div>
  );
}
