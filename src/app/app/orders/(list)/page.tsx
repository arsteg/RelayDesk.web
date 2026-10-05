import Link from "next/link";
import { OrderLink, OrderStatusBadge, PaymentStatusBadge } from "@/components/order-bits";
import { Button, ButtonLink, EmptyState, Input, PageHeader, Pagination, Select, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { qs, sp, type SearchParams } from "@/lib/page";
import { formatDateTime } from "@/lib/time";
import { balanceMinor } from "@/lib/totals";
import { clientOptions } from "@/server/clients";
import { listOrders, ORDER_STATUSES, PAYMENT_STATUSES, type OrderFilters } from "@/server/orders";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("orders.manage");
  const params = await searchParams;
  const filters: OrderFilters = {
    q: sp(params, "q"),
    clientId: sp(params, "clientId"),
    status: sp(params, "status") as OrderFilters["status"],
    paymentStatus: sp(params, "paymentStatus") as OrderFilters["paymentStatus"],
    from: sp(params, "from"),
    to: sp(params, "to"),
    sort: sp(params, "sort") as OrderFilters["sort"],
    page: Number(sp(params, "page") ?? 1) || 1,
  };
  const [{ rows, total, page, pageSize }, clients] = await Promise.all([listOrders(ctx, filters), clientOptions(ctx)]);
  const cur = ctx.business.currency;
  const filtered = Object.entries(filters).some(([k, v]) => k !== "page" && k !== "sort" && v);

  return (
    <>
      <PageHeader title="Orders" description={`${total} orders`} actions={ctx.access.level === "full" && <ButtonLink href="/app/orders/new">New order</ButtonLink>} />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7" role="search">
        <Input name="q" defaultValue={filters.q} placeholder="Order no, client or phone" aria-label="Search" className="lg:col-span-2" />
        <Select name="clientId" defaultValue={filters.clientId ?? ""} aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select name="status" defaultValue={filters.status ?? ""} aria-label="Order status">
          <option value="">Any status</option>
          <option value="OPEN">Open (not completed)</option>
          <option value="OVERDUE">Overdue</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS[s].label}</option>)}
        </Select>
        <Select name="paymentStatus" defaultValue={filters.paymentStatus ?? ""} aria-label="Payment status">
          <option value="">Any payment</option>
          <option value="DUE">Balance due</option>
          {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS[s].label}</option>)}
        </Select>
        <Input type="date" name="from" defaultValue={filters.from} aria-label="Fulfilment from" />
        <Input type="date" name="to" defaultValue={filters.to} aria-label="Fulfilment to" />
        <div className="flex items-center gap-2 lg:col-span-7">
          <Select name="sort" defaultValue={filters.sort ?? "fulfillment_desc"} aria-label="Sort" className="w-auto">
            <option value="fulfillment_desc">Latest fulfilment first</option>
            <option value="fulfillment_asc">Soonest fulfilment first</option>
            <option value="number_desc">Newest order number</option>
          </Select>
          <Button type="submit" variant="secondary">Apply</Button>
          {filtered && <Link href="/app/orders" className="text-sm text-stone-500 hover:underline">Clear filters</Link>}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No orders match these filters" : "No orders yet"}
          description={filtered ? "Try widening the date range or clearing filters." : "Create your first order to start tracking fulfilment and payments."}
          action={!filtered && ctx.access.level === "full" ? <ButtonLink href="/app/orders/new">New order</ButtonLink> : undefined}
        />
      ) : (
        <>
          <TableWrap>
            <thead><tr><Th>Order</Th><Th>Client</Th><Th>Fulfilment</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Payment</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((o) => {
                const bal = balanceMinor(o.totalMinor, o.paidMinor, o.status);
                const overdue = ["CONFIRMED", "IN_PROGRESS", "READY"].includes(o.status) && o.fulfillmentAt < new Date();
                return (
                  <tr key={o.id} className="hover:bg-stone-50">
                    <Td><OrderLink id={o.id} number={o.number} prefix={ctx.business.invoicePrefix} /></Td>
                    <Td><Link href={`/app/clients/${o.client.id}`} className="hover:underline">{o.client.name}</Link></Td>
                    <Td className={overdue ? "text-red-700" : ""}>
                      {formatDateTime(o.fulfillmentAt, ctx.business.timezone)}
                      <span className="ml-1 text-xs text-stone-500">{o.fulfillmentType === "DELIVERY" ? "🚚" : "🏪"}</span>
                    </Td>
                    <Td><OrderStatusBadge status={o.status} /></Td>
                    <Td className="text-right tabular-nums">{formatMoney(o.totalMinor, cur)}</Td>
                    <Td className={`text-right tabular-nums ${bal > 0 ? "text-red-700" : ""}`}>{formatMoney(bal, cur)}</Td>
                    <Td><PaymentStatusBadge status={o.paymentStatus} orderStatus={o.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => qs("/app/orders", { ...filters, page: p })} />
        </>
      )}
    </>
  );
}
