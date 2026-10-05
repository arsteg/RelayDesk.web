"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui";
import { OrderStatusBadge } from "@/components/order/status-badge";
import { apiFetch } from "@/lib/api/client";
import { useRequireCustomer } from "@/lib/api/use-customer";
import { formatMoney } from "@/lib/money";
import type { OrderSummary, Paginated } from "@relaydesk/shared";

export default function OrderHistory() {
  const session = useRequireCustomer();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    apiFetch<Paginated<OrderSummary>>("/customer/orders?pageSize=50", { token: session.token })
      .then((p) => setOrders(p.rows))
      .catch(() => setError("Could not load your orders."));
  }, [session]);

  if (!session) return null;

  return (
    <div>
      <PageHeader title="Your orders" />
      {error && <Alert tone="red" className="mb-4">{error}</Alert>}
      {!orders ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : orders.length === 0 ? (
        <EmptyState title="No orders yet" description="Your placed orders will appear here." />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/order/orders/${o.id}`} className="block">
              <Card className="transition hover:ring-brand-300">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-stone-900">Order #{o.number}</p>
                    <p className="text-sm text-stone-500">
                      {o.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} ·{" "}
                      {o.fulfillmentAt ? new Date(o.fulfillmentAt).toLocaleString() : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <OrderStatusBadge status={o.status} />
                    <p className="mt-1 text-sm font-semibold tabular-nums">{formatMoney(o.totalMinor, o.currency)}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
