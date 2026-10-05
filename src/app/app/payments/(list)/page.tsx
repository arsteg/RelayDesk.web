import Link from "next/link";
import { OrderLink } from "@/components/order-bits";
import { Alert, Button, ButtonLink, EmptyState, Input, PageHeader, Pagination, Select, Stat, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { PAYMENT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { qs, sp, type SearchParams } from "@/lib/page";
import { formatDate } from "@/lib/time";
import { listPayments, PAYMENT_KINDS, PAYMENT_METHODS, type PaymentFilters } from "@/server/payments";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("payments.record");
  const params = await searchParams;
  const f: PaymentFilters = {
    from: sp(params, "from"),
    to: sp(params, "to"),
    method: sp(params, "method") as PaymentFilters["method"],
    kind: sp(params, "kind") as PaymentFilters["kind"],
    includeVoided: sp(params, "voided") === "1",
    page: Number(sp(params, "page") ?? 1) || 1,
  };
  const { rows, total, page, pageSize, totals } = await listPayments(ctx, f);
  const cur = ctx.business.currency;
  const filtered = f.from || f.to || f.method || f.kind || f.includeVoided;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received from your customers (deposits, payments and refunds)."
        actions={ctx.access.level === "full" && <ButtonLink href="/app/payments/new">Record payment</ButtonLink>}
      />
      {params.recorded && <Alert tone="green" className="mb-4">Payment recorded.</Alert>}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Received" value={formatMoney(totals.received, cur)} tone="green" />
        <Stat label="Refunded" value={formatMoney(totals.refunded, cur)} />
        <Stat label="Net" value={formatMoney(totals.net, cur)} />
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <Input type="date" name="from" defaultValue={f.from} aria-label="From date" className="w-auto" />
        <Input type="date" name="to" defaultValue={f.to} aria-label="To date" className="w-auto" />
        <Select name="kind" defaultValue={f.kind ?? ""} className="w-auto" aria-label="Type">
          <option value="">All types</option>
          {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{PAYMENT_KIND[k]}</option>)}
        </Select>
        <Select name="method" defaultValue={f.method ?? ""} className="w-auto" aria-label="Method">
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD[m]}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-stone-600">
          <input type="checkbox" name="voided" value="1" defaultChecked={f.includeVoided} className="rounded border-stone-300" /> Show voided
        </label>
        <Button type="submit" variant="secondary">Filter</Button>
        {filtered && <Link href="/app/payments" className="text-sm text-stone-500 hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No payments found" description="Payments you record against orders appear here." />
      ) : (
        <>
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Order</Th><Th>Client</Th><Th>Type</Th><Th>Method</Th><Th>Reference</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((p) => (
                <tr key={p.id} className={p.voidedAt ? "text-stone-400" : ""}>
                  <Td>{formatDate(p.paidOn)}</Td>
                  <Td><OrderLink id={p.order.id} number={p.order.number} prefix={ctx.business.invoicePrefix} /></Td>
                  <Td><Link href={`/app/clients/${p.order.client.id}`} className="hover:underline">{p.order.client.name}</Link></Td>
                  <Td>{PAYMENT_KIND[p.kind]}{p.voidedAt && " (voided)"}</Td>
                  <Td>{PAYMENT_METHOD[p.method]}</Td>
                  <Td className="max-w-[12rem] truncate">{p.reference ?? "—"}</Td>
                  <Td className={`text-right tabular-nums ${p.voidedAt ? "line-through" : p.kind === "REFUND" ? "text-red-700" : ""}`}>
                    {p.kind === "REFUND" ? "−" : ""}{formatMoney(p.amountMinor, cur)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(n) => qs("/app/payments", { from: f.from, to: f.to, kind: f.kind, method: f.method, voided: f.includeVoided ? "1" : undefined, page: n })} />
        </>
      )}
    </>
  );
}
