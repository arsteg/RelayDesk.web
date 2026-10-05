"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { OrderStatusBadge } from "@/components/order/status-badge";
import { ApiError, apiFetch, openOrderStream } from "@/lib/api/client";
import { formatMoney } from "@/lib/money";
import { STATUS_TRANSITIONS, type OrderSummary, type Paginated } from "@relaydesk/shared";

/**
 * Live incoming-orders dashboard for staff. Uses the admin session cookie
 * (same-origin via /api/py), subscribes to the SSE stream, and falls back to
 * polling with `updatedSince` if the stream drops. No existing admin screen is
 * affected.
 */
export default function LiveOrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<"connected" | "fallback" | "reconnecting">("reconnecting");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const lastSync = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mergeRows = useCallback((rows: OrderSummary[]) => {
    setOrders((prev) => {
      const byId = new Map(prev.map((o) => [o.id, o]));
      for (const r of rows) byId.set(r.id, r);
      // Keep open orders, newest first.
      return [...byId.values()]
        .filter((o) => o.status !== "COMPLETED" && o.status !== "CANCELLED")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const page = await apiFetch<Paginated<OrderSummary>>("/admin/orders?status=OPEN&pageSize=100");
      setOrders(
        page.rows
          .filter((o) => o.status !== "COMPLETED" && o.status !== "CANCELLED")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      lastSync.current = new Date().toISOString();
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load orders.");
    }
  }, []);

  const poll = useCallback(async () => {
    if (!lastSync.current) return loadAll();
    try {
      const since = lastSync.current;
      lastSync.current = new Date().toISOString();
      const page = await apiFetch<Paginated<OrderSummary>>(
        `/admin/orders?pageSize=100&updatedSince=${encodeURIComponent(since)}`,
      );
      if (page.rows.length) mergeRows(page.rows);
    } catch {
      /* transient; next tick retries */
    }
  }, [loadAll, mergeRows]);

  useEffect(() => {
    // Initial fetch (async) + live subscription; both update state later.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
    const stop = openOrderStream({
      path: "/admin/realtime/stream",
      onEvent: () => poll(),
      onStatus: (s) => {
        setLive(s);
        if (s === "fallback" && !pollRef.current) pollRef.current = setInterval(poll, 5000);
        if (s === "connected" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      },
    });
    return () => {
      stop();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadAll, poll]);

  const changeStatus = async (order: OrderSummary, status: string) => {
    setUpdatingId(order.id);
    try {
      await apiFetch(`/admin/orders/${order.id}/status`, { body: { status } });
      await poll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Live orders"
        description="Incoming customer orders update here in real time."
        actions={
          <Badge tone={live === "connected" ? "green" : live === "fallback" ? "amber" : "gray"}>
            {live === "connected" ? "● Live" : live === "fallback" ? "Polling" : "Connecting…"}
          </Badge>
        }
      />
      {error && <Alert tone="red" className="mb-4">{error}</Alert>}
      {orders.length === 0 ? (
        <EmptyState title="No open orders" description="New orders from customers will appear here automatically." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {orders.map((o) => (
            <Card key={o.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/app/orders/${o.id}`} className="font-medium text-stone-900 hover:underline">
                      #{o.number}
                    </Link>
                    <OrderStatusBadge status={o.status} />
                    {o.placedByCustomer && <Badge tone="violet">Customer</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-stone-600">{o.clientName ?? "—"}</p>
                  <p className="text-sm text-stone-500">
                    {o.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"} ·{" "}
                    {o.fulfillmentAt ? new Date(o.fulfillmentAt).toLocaleString() : "—"} · {o.itemCount ?? 0} items
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-semibold tabular-nums">{formatMoney(o.totalMinor, o.currency)}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUS_TRANSITIONS[o.status].map((next) => (
                  <Button
                    key={next}
                    size="sm"
                    variant={next === "CANCELLED" ? "danger" : "secondary"}
                    disabled={updatingId === o.id}
                    onClick={() => changeStatus(o, next)}
                  >
                    {next === "IN_PROGRESS" ? "Start" : next === "READY" ? "Ready" : next === "COMPLETED" ? "Complete" : next === "CONFIRMED" ? "Confirm" : "Cancel"}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
