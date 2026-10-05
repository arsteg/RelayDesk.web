"use client";

import { use, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Badge, Card, DescriptionList, PageHeader } from "@/components/ui";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/order/status-badge";
import { apiFetch, openOrderStream } from "@/lib/api/client";
import { PayButton } from "./pay-button";
import { useRequireCustomer } from "@/lib/api/use-customer";
import { formatMoney } from "@/lib/money";
import { formatQuantity } from "@/lib/money";
import type { OrderDetail } from "@relaydesk/shared";

export default function CustomerOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useRequireCustomer();
  const placed = useSearchParams().get("placed") === "1";
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"connected" | "fallback" | "reconnecting">("reconnecting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (token: string) => {
    try {
      setOrder(await apiFetch<OrderDetail>(`/customer/orders/${id}`, { token }));
    } catch {
      setError("Could not load this order.");
    }
  };

  useEffect(() => {
    if (!session) return;
    // Initial fetch (async) + live subscription; state updates land later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(session.token);
    // Live status via SSE; fall back to polling if the stream drops.
    const stop = openOrderStream({
      path: "/customer/realtime/stream",
      token: session.token,
      onEvent: (e) => {
        const evOrder = e.order as { id?: string } | undefined;
        if (evOrder?.id === id) load(session.token);
      },
      onStatus: (s) => {
        setLive(s);
        if (s === "fallback" && !pollRef.current) {
          pollRef.current = setInterval(() => load(session.token), 5000);
        }
      },
    });
    return () => {
      stop();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, id]);

  if (!session) return null;
  const currency = session.business.currency;

  return (
    <div className="space-y-5">
      <PageHeader
        title={order ? `Order #${order.number}` : "Order"}
        back={{ href: "/order/orders", label: "All orders" }}
        actions={
          <Badge tone={live === "connected" ? "green" : live === "fallback" ? "amber" : "gray"}>
            {live === "connected" ? "Live" : live === "fallback" ? "Updating…" : "Connecting…"}
          </Badge>
        }
      />
      {placed && <Alert tone="green" title="Order placed!">The business can now see your order and will start preparing it.</Alert>}
      {error && <Alert tone="red">{error}</Alert>}

      {!order ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : (
        <>
          <Card
            title="Status"
            actions={
              <div className="flex gap-2">
                <OrderStatusBadge status={order.status} />
                <PaymentStatusBadge status={order.paymentStatus} />
              </div>
            }
          >
            <ol className="space-y-2">
              {order.statusHistory.map((h) => (
                <li key={h.id} className="flex items-center gap-3 text-sm">
                  <OrderStatusBadge status={h.toStatus} />
                  <span className="text-stone-500">{new Date(h.createdAt).toLocaleString()}</span>
                  {h.reason && <span className="text-stone-500">· {h.reason}</span>}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Items">
            <ul className="divide-y divide-stone-100">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-stone-800">
                    {formatQuantity(i.quantityMilli)} × {i.description}
                  </span>
                  <span className="tabular-nums">{formatMoney(i.lineTotalMinor, currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Subtotal" value={formatMoney(order.subtotalMinor, currency)} />
              {order.discountMinor > 0 && <Row label="Discount" value={`− ${formatMoney(order.discountMinor, currency)}`} />}
              {order.taxMinor > 0 && <Row label="Tax" value={formatMoney(order.taxMinor, currency)} />}
              {order.deliveryChargeMinor > 0 && <Row label="Delivery" value={formatMoney(order.deliveryChargeMinor, currency)} />}
              <Row label="Total" value={formatMoney(order.totalMinor, currency)} strong />
            </dl>
          </Card>

          {order.status !== "CANCELLED" && order.paymentStatus !== "PAID" && order.paymentStatus !== "OVERPAID" && (
            <Card title="Payment">
              <p className="mb-3 text-sm text-stone-600">Pay the outstanding balance online.</p>
              <PayButton orderId={id} token={session.token} onPaid={() => load(session.token)} />
            </Card>
          )}

          <Card title="Details">
            <DescriptionList
              items={[
                { label: "Fulfilment", value: order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup" },
                { label: "When", value: order.fulfillmentAt ? new Date(order.fulfillmentAt).toLocaleString() : "—" },
                ...(order.deliveryAddress ? [{ label: "Address", value: order.deliveryAddress }] : []),
                ...(order.notes ? [{ label: "Notes", value: order.notes }] : []),
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-stone-500">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</dd>
    </div>
  );
}
