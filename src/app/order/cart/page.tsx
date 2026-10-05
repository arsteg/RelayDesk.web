"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api/client";
import { cartSubtotalMinor, clearCart, setQuantity, useCart } from "@/lib/api/cart";
import { useRequireCustomer } from "@/lib/api/use-customer";
import { formatMoney } from "@/lib/money";
import type { OrderDetail, PlaceOrderRequest } from "@relaydesk/shared";

function defaultFulfillment(): string {
  // Tomorrow at 10:00 local, formatted for <input type="datetime-local">.
  const d = new Date(Date.now() + 86400_000);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CartPage() {
  const session = useRequireCustomer();
  const router = useRouter();
  const cart = useCart(session?.business.id);
  const [fulfillmentType, setFulfillmentType] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [fulfillmentAt, setFulfillmentAt] = useState(defaultFulfillment());
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return null;
  const currency = session.business.currency;
  const subtotal = cartSubtotalMinor(cart);

  const placeOrder = async () => {
    setError(null);
    setBusy(true);
    try {
      const body: PlaceOrderRequest = {
        items: cart.map((l) => ({ productId: l.productId, quantity: String(l.quantity) })),
        fulfillmentType,
        fulfillmentAt: new Date(fulfillmentAt).toISOString(),
        deliveryAddress: fulfillmentType === "DELIVERY" ? deliveryAddress : null,
        notes: notes || null,
      };
      const order = await apiFetch<OrderDetail>("/customer/orders", { token: session.token, body });
      clearCart(session.business.id);
      router.push(`/order/orders/${order.id}?placed=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not place the order.");
    } finally {
      setBusy(false);
    }
  };

  if (cart.length === 0) {
    return (
      <div>
        <PageHeader title="Your cart" />
        <EmptyState title="Your cart is empty" description="Add items from the menu to place an order." action={<Button onClick={() => router.push("/order/menu")}>Browse menu</Button>} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Your cart" back={{ href: "/order/menu", label: "Back to menu" }} />
      {error && <Alert tone="red">{error}</Alert>}

      <Card title="Items">
        <ul className="divide-y divide-stone-100">
          {cart.map((l) => (
            <li key={l.productId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium text-stone-900">{l.name}</p>
                <p className="text-sm text-stone-500">{formatMoney(l.priceMinor, currency)} / {l.unit}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  value={l.quantity}
                  onChange={(e) => setQuantity(session.business.id, l.productId, Number(e.target.value))}
                  className="w-20"
                  aria-label={`Quantity of ${l.name}`}
                />
                <span className="w-24 text-right text-sm font-medium tabular-nums">
                  {formatMoney(Math.round(l.priceMinor * l.quantity), currency)}
                </span>
                <button onClick={() => setQuantity(session.business.id, l.productId, 0)} className="text-sm text-stone-400 hover:text-red-600" aria-label={`Remove ${l.name}`}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-sm">
          <span className="text-stone-500">Subtotal (before tax)</span>
          <span className="font-semibold tabular-nums">{formatMoney(subtotal, currency)}</span>
        </div>
        <p className="mt-1 text-xs text-stone-400">Taxes and any delivery charge are calculated by the business when the order is confirmed.</p>
      </Card>

      <Card title="Fulfilment">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="ftype">
            <Select id="ftype" value={fulfillmentType} onChange={(e) => setFulfillmentType(e.target.value as "PICKUP" | "DELIVERY")}>
              <option value="PICKUP">Pickup</option>
              <option value="DELIVERY">Delivery</option>
            </Select>
          </Field>
          <Field label="When" htmlFor="when">
            <Input id="when" type="datetime-local" value={fulfillmentAt} onChange={(e) => setFulfillmentAt(e.target.value)} />
          </Field>
          {fulfillmentType === "DELIVERY" && (
            <Field label="Delivery address" htmlFor="addr" className="sm:col-span-2">
              <Textarea id="addr" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} required />
            </Field>
          )}
          <Field label="Notes (optional)" htmlFor="notes" className="sm:col-span-2">
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={placeOrder} disabled={busy}>
            {busy ? "Placing order…" : "Place order"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
