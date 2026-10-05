import { OrderForm } from "@/components/orders/order-form";
import { Alert, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatBps } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/page";
import { addDaysYmd, zonedDateString } from "@/lib/time";
import { clientOptions } from "@/server/clients";
import { listProducts } from "@/server/products";
import { createOrderAction } from "@/app/actions/business";

export const metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("orders.manage");
  if (ctx.access.level !== "full") return <Alert tone="red">{ctx.access.reason}</Alert>;
  const clientId = sp(await searchParams, "clientId") ?? "";
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { availableOnly: true })]);
  const today = zonedDateString(new Date(), ctx.business.timezone);
  return (
    <>
      <PageHeader title="New order" back={{ href: "/app/orders", label: "Orders" }} />
      {clients.length === 0 ? (
        <EmptyState title="Add a client first" description="Every order belongs to a client." action={<ButtonLink href="/app/clients/new?next=order">New client</ButtonLink>} />
      ) : (
        <OrderForm
          action={createOrderAction}
          clients={clients}
          products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, priceMinor: p.priceMinor, category: p.category?.name ?? null }))}
          currency={ctx.business.currency}
          initial={{
            clientId: clients.some((c) => c.id === clientId) ? clientId : "",
            orderDate: today,
            fulfillmentAt: `${addDaysYmd(today, 1)}T10:00`,
            fulfillmentType: "PICKUP",
            deliveryAddress: "",
            notes: "",
            discount: "",
            taxRate: formatBps(ctx.business.defaultTaxBps),
            deliveryCharge: "",
            status: "CONFIRMED",
            items: [],
          }}
        />
      )}
    </>
  );
}
