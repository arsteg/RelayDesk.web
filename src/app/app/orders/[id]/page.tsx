import Link from "next/link";
import { ActionButton } from "@/components/forms";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order-bits";
import { CaptureForm, NotDeliveredForm, ShortfallForm } from "@/components/order/ops-forms";
import { PaymentForm, VoidPaymentForm } from "@/components/payments/payment-form";
import { Alert, ButtonLink, Card, DescriptionList, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { PAYMENT_KIND, PAYMENT_METHOD, STATUS_ACTION } from "@/lib/labels";
import { formatBps, formatMoney, formatQuantity, minorToInput } from "@/lib/money";
import { can } from "@/lib/permissions";
import { orNotFound, type SearchParams } from "@/lib/page";
import { formatDate, formatDateTime, zonedDateString } from "@/lib/time";
import { balanceMinor } from "@/lib/totals";
import { EDITABLE_STATUSES, formatOrderNumber, getOrder, STATUS_TRANSITIONS } from "@/server/orders";
import { changeOrderStatusAction } from "@/app/actions/business";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireTenantPage("orders.manage");
  const order = await orNotFound(getOrder(ctx, (await params).id));
  const q = await searchParams;
  const cur = ctx.business.currency;
  const tz = ctx.business.timezone;
  const number = formatOrderNumber(ctx.business.invoicePrefix, order.number);
  const writable = ctx.access.level === "full";
  const balance = balanceMinor(order.totalMinor, order.paidMinor, order.status);
  const transitions = STATUS_TRANSITIONS[order.status];

  return (
    <>
      <PageHeader
        back={{ href: "/app/orders", label: "Orders" }}
        title={<span className="flex flex-wrap items-center gap-2">{number} <OrderStatusBadge status={order.status} /> <PaymentStatusBadge status={order.paymentStatus} orderStatus={order.status} /></span>}
        description={<>For <Link href={`/app/clients/${order.client.id}`} className="font-medium text-stone-700 hover:underline">{order.client.name}</Link> · {order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} {formatDateTime(order.fulfillmentAt, tz)}</>}
        actions={
          <>
            <ButtonLink href={`/invoice/${order.id}`} variant="secondary" target="_blank">Invoice / print</ButtonLink>
            {writable && EDITABLE_STATUSES.includes(order.status) && <ButtonLink href={`/app/orders/${order.id}/edit`} variant="secondary">Edit</ButtonLink>}
          </>
        }
      />
      {q.created && <Alert tone="green" className="mb-4">Order {number} created.</Alert>}
      {q.paid && <Alert tone="green" className="mb-4">Payment recorded.</Alert>}
      {order.paymentStatus === "OVERPAID" && (
        <Alert tone="amber" className="mb-4">
          {formatMoney(-balance, cur)} has been received beyond what is due. {can(ctx.role, "payments.refund") ? "Record a refund to settle this order." : "Ask an owner or admin to record the refund."}
        </Alert>
      )}

      {writable && transitions.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-stone-200">
          <span className="text-sm text-stone-600">Next step:</span>
          {transitions.map((s) => (
            <ActionButton
              key={s}
              action={changeOrderStatusAction}
              fields={{ id: order.id, status: s }}
              variant={s === "CANCELLED" ? "danger" : "secondary"}
              confirm={s === "CANCELLED" ? "Cancel this order? This cannot be undone." : undefined}
            >
              {STATUS_ACTION[s]}
            </ActionButton>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TableWrap>
            <thead><tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Line total</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {order.items.map((i) => (
                <tr key={i.id}>
                  <Td className="whitespace-normal">{i.description}{i.isCustom && <span className="ml-1 text-xs text-stone-400">(custom)</span>}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(i.quantityMilli)} {i.unit}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.unitPriceMinor, cur)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(i.lineTotalMinor, cur)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              {[
                ["Subtotal", order.subtotalMinor],
                ...(order.discountMinor ? [["Discount", -order.discountMinor] as const] : []),
                ...(order.taxBps ? [[`Tax (${formatBps(order.taxBps)}%)`, order.taxMinor] as const] : []),
                ...(order.deliveryChargeMinor ? [["Delivery", order.deliveryChargeMinor] as const] : []),
              ].map(([label, v]) => (
                <tr key={label as string}><Td colSpan={3} className="text-right text-stone-500">{label}</Td><Td className="text-right tabular-nums">{(v as number) < 0 ? `−${formatMoney(-(v as number), cur)}` : formatMoney(v as number, cur)}</Td></tr>
              ))}
              <tr className="font-semibold"><Td colSpan={3} className="text-right">Total</Td><Td className="text-right tabular-nums">{formatMoney(order.totalMinor, cur)}</Td></tr>
              <tr><Td colSpan={3} className="text-right text-stone-500">Paid</Td><Td className="text-right tabular-nums text-emerald-700">{formatMoney(order.paidMinor, cur)}</Td></tr>
              <tr className="font-semibold"><Td colSpan={3} className="text-right">{balance < 0 ? "Refund due" : "Balance due"}</Td><Td className={`text-right tabular-nums ${balance > 0 ? "text-red-700" : ""}`}>{formatMoney(Math.abs(balance), cur)}</Td></tr>
            </tfoot>
          </TableWrap>

          {writable && order.status !== "CANCELLED" && order.status !== "COMPLETED" && (can(ctx.role, "prep.record") || can(ctx.role, "orders.adjust")) && order.items.length > 0 && (
            <Card title="Preparation & delivery adjustments">
              <ul className="divide-y divide-stone-100">
                {order.items.map((i) => (
                  <li key={i.id} className="space-y-2 py-3">
                    <p className="text-sm font-medium">
                      {i.description} <span className="text-stone-400">· now {formatQuantity(i.quantityMilli)} {i.unit}</span>
                    </p>
                    {can(ctx.role, "prep.record") && <CaptureForm orderId={order.id} orderItemId={i.id} />}
                    {can(ctx.role, "orders.adjust") && (
                      <div className="flex flex-wrap gap-4">
                        <ShortfallForm orderId={order.id} orderItemId={i.id} />
                        <NotDeliveredForm orderId={order.id} orderItemId={i.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-stone-500">Weights set the billed quantity (gross − tare). Shortfall reduces a line to the received amount; not-delivered removes it. Every change is logged.</p>
            </Card>
          )}

          <Card title="Payment history">
            {order.payments.length === 0 ? (
              <p className="text-sm text-stone-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className={p.voidedAt ? "text-stone-400" : ""}>
                      <p className="text-sm">
                        <span className={p.voidedAt ? "line-through" : "font-medium"}>{PAYMENT_KIND[p.kind]} · {p.kind === "REFUND" ? "−" : ""}{formatMoney(p.amountMinor, cur)}</span>
                        <span className="text-stone-500"> · {PAYMENT_METHOD[p.method]} · {formatDate(p.paidOn)}</span>
                      </p>
                      {p.reference && <p className="text-xs text-stone-500">Ref: {p.reference}</p>}
                      {p.notes && <p className="text-xs text-stone-500">{p.notes}</p>}
                      {p.voidedAt && <p className="text-xs text-red-600">Voided {formatDateTime(p.voidedAt, tz)}: {p.voidReason}</p>}
                    </div>
                    {!p.voidedAt && writable && can(ctx.role, "payments.void") && <VoidPaymentForm paymentId={p.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {writable && (order.status !== "CANCELLED" ? (balance > 0 || can(ctx.role, "payments.refund")) : order.paidMinor > 0 && can(ctx.role, "payments.refund")) && (
            <Card title={order.status === "CANCELLED" ? "Record refund" : "Record payment"}>
              <PaymentForm
                orderId={order.id}
                today={zonedDateString(new Date(), tz)}
                balance={balance > 0 ? minorToInput(balance, cur) : undefined}
                paid={balance <= 0}
                cancelled={order.status === "CANCELLED"}
                canRefund={can(ctx.role, "payments.refund")}
              />
            </Card>
          )}
          <Card title="Details">
            <DescriptionList
              items={[
                { label: "Order date", value: formatDate(order.orderDate) },
                { label: "Fulfilment", value: `${order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} · ${formatDateTime(order.fulfillmentAt, tz)}` },
                ...(order.deliveryAddress ? [{ label: "Delivery address", value: <span className="whitespace-pre-line">{order.deliveryAddress}</span> }] : []),
                { label: "Client phone", value: order.client.phone },
                { label: "Notes", value: order.notes && <span className="whitespace-pre-line">{order.notes}</span> },
                { label: "Created", value: formatDateTime(order.createdAt, tz) },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
