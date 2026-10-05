import { ActionButton } from "@/components/forms";
import { OrderLink, OrderStatusBadge, PaymentStatusBadge } from "@/components/order-bits";
import { Badge, ButtonLink, Card, DescriptionList, EmptyState, PageHeader, Stat, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { can } from "@/lib/permissions";
import { PAYMENT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { orNotFound } from "@/lib/page";
import { formatDate, formatDateTime } from "@/lib/time";
import { getClientDetail } from "@/server/clients";
import { archiveClientAction } from "@/app/actions/business";

export const metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage("clients.manage");
  const { client, orders, payments, summary } = await orNotFound(getClientDetail(ctx, (await params).id));
  const cur = ctx.business.currency;
  const writable = ctx.access.level === "full";

  return (
    <>
      <PageHeader
        back={{ href: "/app/clients", label: "Clients" }}
        title={<span className="flex items-center gap-2">{client.name} {client.archivedAt && <Badge>Archived</Badge>}</span>}
        actions={
          writable && (
            <>
              {!client.archivedAt && <ButtonLink href={`/app/orders/new?clientId=${client.id}`}>New order</ButtonLink>}
              {can(ctx.role, "pricing.manage") && <ButtonLink href={`/app/clients/${client.id}/pricing`} variant="secondary">Pricing</ButtonLink>}
              <ButtonLink href={`/app/clients/${client.id}/edit`} variant="secondary">Edit</ButtonLink>
              <ActionButton
                action={archiveClientAction}
                fields={{ id: client.id, archived: client.archivedAt ? "0" : "1" }}
                confirm={client.archivedAt ? undefined : "Archive this client? Their history is kept."}
              >
                {client.archivedAt ? "Restore" : "Archive"}
              </ActionButton>
            </>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders" value={orders.length} />
        <Stat label="Total billed" value={formatMoney(summary.totalBilledMinor, cur)} />
        <Stat label="Paid" value={formatMoney(summary.totalPaidMinor, cur)} tone="green" />
        <Stat label="Outstanding" value={formatMoney(summary.outstandingMinor, cur)} tone={summary.outstandingMinor > 0 ? "red" : undefined} hint={summary.refundDueMinor > 0 ? `${formatMoney(summary.refundDueMinor, cur)} refund due` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-1">
          <DescriptionList
            items={[
              { label: "Phone", value: client.phone },
              { label: "Email", value: client.email },
              { label: "Address", value: client.address && <span className="whitespace-pre-line">{client.address}</span> },
              { label: "Notes", value: client.notes && <span className="whitespace-pre-line">{client.notes}</span> },
              { label: "Client since", value: formatDate(client.createdAt, ctx.business.timezone) },
            ]}
          />
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Order history</h2>
            {orders.length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              <TableWrap>
                <thead><tr><Th>Order</Th><Th>Fulfilment</Th><Th>Status</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Payment</Th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <Td><OrderLink id={o.id} number={o.number} prefix={ctx.business.invoicePrefix} /></Td>
                      <Td>{formatDateTime(o.fulfillmentAt, ctx.business.timezone)}</Td>
                      <Td><OrderStatusBadge status={o.status} /></Td>
                      <Td className="text-right tabular-nums">{formatMoney(o.totalMinor, cur)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney((o.status === "CANCELLED" ? 0 : o.totalMinor) - o.paidMinor, cur)}</Td>
                      <Td><PaymentStatusBadge status={o.paymentStatus} orderStatus={o.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Payments</h2>
            {payments.length === 0 ? (
              <EmptyState title="No payments recorded" />
            ) : (
              <TableWrap>
                <thead><tr><Th>Date</Th><Th>Order</Th><Th>Type</Th><Th>Method</Th><Th className="text-right">Amount</Th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {payments.map((p) => (
                    <tr key={p.id} className={p.voidedAt ? "text-stone-400 line-through" : ""}>
                      <Td>{formatDate(p.paidOn)}</Td>
                      <Td><OrderLink id={p.order.id} number={p.order.number} prefix={ctx.business.invoicePrefix} /></Td>
                      <Td>{PAYMENT_KIND[p.kind]}{p.voidedAt && " (voided)"}</Td>
                      <Td>{PAYMENT_METHOD[p.method]}</Td>
                      <Td className="text-right tabular-nums">{p.kind === "REFUND" ? "−" : ""}{formatMoney(p.amountMinor, cur)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
