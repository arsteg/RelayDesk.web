import { PaymentForm } from "@/components/payments/payment-form";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { zonedDateString } from "@/lib/time";
import { formatOrderNumber, listOrders } from "@/server/orders";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage() {
  const ctx = await requireTenantPage("payments.record");
  if (ctx.access.level !== "full") return <Alert tone="red">{ctx.access.reason}</Alert>;
  const { rows } = await listOrders(ctx, { paymentStatus: "DUE", sort: "fulfillment_asc", pageSize: 100 });
  const cur = ctx.business.currency;
  return (
    <>
      <PageHeader title="Record payment" back={{ href: "/app/payments", label: "Payments" }} description="For refunds or orders without a balance, open the order itself." />
      {rows.length === 0 ? (
        <EmptyState title="No orders with an outstanding balance" />
      ) : (
        <Card className="max-w-2xl">
          <PaymentForm
            back="payments"
            today={zonedDateString(new Date(), ctx.business.timezone)}
            orders={rows.map((o) => ({
              id: o.id,
              label: `${formatOrderNumber(ctx.business.invoicePrefix, o.number)} · ${o.client.name} · balance ${formatMoney(o.totalMinor - o.paidMinor, cur)}`,
            }))}
          />
        </Card>
      )}
    </>
  );
}
