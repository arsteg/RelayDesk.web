import { notFound } from "next/navigation";
import { OrderForm } from "@/components/orders/order-form";
import { Alert, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatBps, formatQuantity, minorToInput } from "@/lib/money";
import { orNotFound } from "@/lib/page";
import { dateOnlyToString, utcToZonedInput } from "@/lib/time";
import { clientOptions } from "@/server/clients";
import { EDITABLE_STATUSES, formatOrderNumber, getOrder } from "@/server/orders";
import { listProducts } from "@/server/products";
import { updateOrderAction } from "@/app/actions/business";

export const metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage("orders.manage");
  const order = await orNotFound(getOrder(ctx, (await params).id));
  if (!order) notFound();
  const number = formatOrderNumber(ctx.business.invoicePrefix, order.number);
  const back = { href: `/app/orders/${order.id}`, label: number };
  if (!EDITABLE_STATUSES.includes(order.status) || ctx.access.level !== "full") {
    return (
      <>
        <PageHeader title={`Edit ${number}`} back={back} />
        <Alert tone="amber">{ctx.access.level !== "full" ? ctx.access.reason : "Completed and cancelled orders can no longer be edited."}</Alert>
      </>
    );
  }
  const [clients, products] = await Promise.all([clientOptions(ctx), listProducts(ctx, { availableOnly: true })]);
  // Keep the current client selectable even if archived.
  if (!clients.some((c) => c.id === order.clientId)) clients.unshift({ id: order.client.id, name: `${order.client.name} (archived)`, phone: order.client.phone, address: order.client.address });
  const cur = ctx.business.currency;
  return (
    <>
      <PageHeader title={`Edit ${number}`} back={back} description="Existing lines keep the price they were sold at unless you change them." />
      <OrderForm
        action={updateOrderAction}
        orderId={order.id}
        clients={clients}
        products={products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, priceMinor: p.priceMinor, category: p.category?.name ?? null }))}
        currency={cur}
        initial={{
          expectedUpdatedAt: order.updatedAt.toISOString(),
          clientId: order.clientId,
          orderDate: dateOnlyToString(order.orderDate),
          fulfillmentAt: utcToZonedInput(order.fulfillmentAt, ctx.business.timezone),
          fulfillmentType: order.fulfillmentType,
          deliveryAddress: order.deliveryAddress ?? "",
          notes: order.notes ?? "",
          discount: order.discountMinor ? minorToInput(order.discountMinor, cur) : "",
          taxRate: formatBps(order.taxBps),
          deliveryCharge: order.deliveryChargeMinor ? minorToInput(order.deliveryChargeMinor, cur) : "",
          items: order.items.map((i) => ({
            productId: i.productId,
            description: i.description,
            unit: i.unit,
            quantity: formatQuantity(i.quantityMilli),
            unitPrice: minorToInput(i.unitPriceMinor, cur),
          })),
        }}
      />
    </>
  );
}
