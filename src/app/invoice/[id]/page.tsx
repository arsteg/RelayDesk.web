import { notFound, redirect } from "next/navigation";
import { getTenant } from "@/lib/auth/current";
import { PAYMENT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatBps, formatMoney, formatQuantity } from "@/lib/money";
import { orNotFound } from "@/lib/page";
import { formatDate, formatDateTime } from "@/lib/time";
import { balanceMinor } from "@/lib/totals";
import { formatOrderNumber, getOrder } from "@/server/orders";
import { getSettings } from "@/server/settings";
import { PrintButton } from "./print-button";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenant();
  if (ctx.access.level === "suspended") redirect("/suspended");
  const order = await orNotFound(getOrder(ctx, (await params).id));
  if (!order) notFound();
  const business = await getSettings(ctx);
  const cur = business.currency;
  const number = formatOrderNumber(business.invoicePrefix, order.number);
  const balance = balanceMinor(order.totalMinor, order.paidMinor, order.status);
  const payments = order.payments.filter((p) => !p.voidedAt);

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 sm:my-8 sm:rounded-xl sm:p-10 sm:shadow-sm sm:ring-1 sm:ring-stone-200 print:m-0 print:p-0 print:shadow-none print:ring-0">
      <div className="no-print mb-6 flex justify-end gap-2">
        <PrintButton />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-stone-200 pb-6">
        <div className="flex items-start gap-4">
          {business.logoMimeType && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/logo?v=${business.updatedAt.getTime()}`} alt={`${business.name} logo`} className="h-16 w-16 rounded-lg object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold text-stone-900">{business.name}</h1>
            {business.address && <p className="whitespace-pre-line text-sm text-stone-600">{business.address}</p>}
            <p className="text-sm text-stone-600">{[business.phone, business.email, business.website].filter(Boolean).join(" · ")}</p>
            {business.taxId && <p className="text-sm text-stone-600">Tax ID: {business.taxId}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-brand-700">{order.status === "DRAFT" ? "Quote" : "Invoice"}</p>
          <p className="text-sm text-stone-600">No. {number}</p>
          <p className="text-sm text-stone-600">Date {formatDate(order.orderDate)}</p>
          {order.status === "CANCELLED" && <p className="mt-1 text-sm font-semibold text-red-600">CANCELLED</p>}
        </div>
      </header>

      <section className="grid gap-6 py-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Bill to</p>
          <p className="font-medium">{order.client.name}</p>
          {order.client.phone && <p className="text-sm text-stone-600">{order.client.phone}</p>}
          {order.client.email && <p className="text-sm text-stone-600">{order.client.email}</p>}
          {order.client.address && <p className="whitespace-pre-line text-sm text-stone-600">{order.client.address}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}</p>
          <p className="text-sm">{formatDateTime(order.fulfillmentAt, business.timezone)}</p>
          {order.deliveryAddress && <p className="whitespace-pre-line text-sm text-stone-600">{order.deliveryAddress}</p>}
        </div>
      </section>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-300 text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="border-b border-stone-100">
              <td className="py-2 pr-2">{i.description}</td>
              <td className="py-2 text-right tabular-nums">{formatQuantity(i.quantityMilli)} {i.unit}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(i.unitPriceMinor, cur)}</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(i.lineTotalMinor, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(order.subtotalMinor, cur)}</dd></div>
          {order.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{formatMoney(order.discountMinor, cur)}</dd></div>}
          {order.taxBps > 0 && <div className="flex justify-between"><dt>Tax ({formatBps(order.taxBps)}%)</dt><dd className="tabular-nums">{formatMoney(order.taxMinor, cur)}</dd></div>}
          {order.deliveryChargeMinor > 0 && <div className="flex justify-between"><dt>Delivery</dt><dd className="tabular-nums">{formatMoney(order.deliveryChargeMinor, cur)}</dd></div>}
          <div className="flex justify-between border-t border-stone-300 pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(order.totalMinor, cur)}</dd></div>
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between text-stone-600">
              <dt>{PAYMENT_KIND[p.kind]} {formatDate(p.paidOn)} ({PAYMENT_METHOD[p.method]})</dt>
              <dd className="tabular-nums">{p.kind === "REFUND" ? "+" : "−"}{formatMoney(p.amountMinor, cur)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-stone-300 pt-1 text-base font-semibold">
            <dt>{balance < 0 ? "Refund due" : "Balance due"}</dt><dd className="tabular-nums">{formatMoney(Math.abs(balance), cur)}</dd>
          </div>
        </dl>
      </div>

      {order.notes && (
        <section className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Notes</p>
          <p className="whitespace-pre-line text-sm text-stone-700">{order.notes}</p>
        </section>
      )}
      {business.invoiceFooter && <footer className="mt-10 border-t border-stone-200 pt-4 text-center text-xs whitespace-pre-line text-stone-500">{business.invoiceFooter}</footer>}
    </div>
  );
}
