"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { addToCart, useCart } from "@/lib/api/cart";
import { useRequireCustomer } from "@/lib/api/use-customer";
import { formatMoney } from "@/lib/money";
import type { MenuResponse } from "@relaydesk/shared";

export default function MenuPage() {
  const session = useRequireCustomer();
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cart = useCart(session?.business.id);

  useEffect(() => {
    if (!session) return;
    apiFetch<MenuResponse>("/customer/menu", { token: session.token })
      .then(setMenu)
      .catch(() => setError("Could not load the menu. Please try again."));
  }, [session]);

  const grouped = useMemo(() => {
    if (!menu) return [];
    const byCat = new Map<string | null, typeof menu.items>();
    for (const item of menu.items) {
      const key = item.categoryId;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(item);
    }
    const catName = (id: string | null) => menu.categories.find((c) => c.id === id)?.name ?? "Other";
    return [...byCat.entries()].sort((a, b) => catName(a[0]).localeCompare(catName(b[0]))).map(([id, items]) => ({
      id,
      name: catName(id),
      items,
    }));
  }, [menu]);

  if (!session) return null;
  const currency = session.business.currency;
  const cartQty = (productId: string) => cart.find((l) => l.productId === productId)?.quantity ?? 0;
  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

  return (
    <div>
      <PageHeader
        title="Menu"
        description={`Order from ${session.business.name}`}
        actions={cartCount > 0 ? <Link href="/order/cart" className="inline-flex"><Button>View cart ({cartCount})</Button></Link> : undefined}
      />
      {error && <Alert tone="red" className="mb-4">{error}</Alert>}
      {!menu ? (
        <p className="text-sm text-stone-500">Loading menu…</p>
      ) : menu.items.length === 0 ? (
        <EmptyState title="No items available yet" description="This business hasn't published any products. Check back soon." />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.id ?? "none"}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{group.name}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.items.map((item) => (
                  <Card key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-stone-900">{item.name}</p>
                        {item.description && <p className="mt-0.5 text-sm text-stone-500">{item.description}</p>}
                        <p className="mt-1 text-sm font-semibold text-stone-800">
                          {formatMoney(item.priceMinor, currency)} <span className="font-normal text-stone-400">/ {item.unit}</span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {cartQty(item.id) > 0 && <Badge tone="green">{cartQty(item.id)} in cart</Badge>}
                        <div className="mt-1">
                          <Button
                            size="sm"
                            onClick={() =>
                              addToCart(session.business.id, {
                                productId: item.id,
                                name: item.name,
                                priceMinor: item.priceMinor,
                                unit: item.unit,
                              })
                            }
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
