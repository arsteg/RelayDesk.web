"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { SubmitButton } from "@/components/forms";
import { Alert, Button, ButtonLink, Card, Field, Input, Select, Textarea, cx } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { formatMoney, minorToInput, parseMoneyToMinor, parsePercentToBps, parseQuantityToMilli } from "@/lib/money";
import { computeTotals, lineTotal } from "@/lib/totals";

export interface OrderFormItem {
  productId: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  unitPrice: string;
}

export interface OrderFormValues {
  clientId: string;
  orderDate: string;
  fulfillmentAt: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  deliveryAddress: string;
  notes: string;
  discount: string;
  taxRate: string;
  deliveryCharge: string;
  status?: "DRAFT" | "CONFIRMED";
  expectedUpdatedAt?: string;
  items: OrderFormItem[];
}

interface Props {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  orderId?: string;
  initial: OrderFormValues;
  clients: { id: string; name: string; phone: string | null; address: string | null }[];
  products: { id: string; name: string; unit: string; priceMinor: number; category: string | null }[];
  currency: string;
}

type Row = OrderFormItem & { key: number };
let nextKey = 1;

export function OrderForm({ action, orderId, initial, clients, products, currency }: Props) {
  const [state, formAction] = useActionState(action, {});
  const [v, setV] = useState<Omit<OrderFormValues, "items">>(() => {
    const { items: _items, ...rest } = initial;
    return rest;
  });
  const [rows, setRows] = useState<Row[]>(() => initial.items.map((i) => ({ ...i, key: nextKey++ })));
  const [pick, setPick] = useState("");
  // Per-customer prices (productId -> priceMinor) for the selected client.
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const e = state.fieldErrors ?? {};
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));

  const priceFor = (productId: string) => priceMap[productId] ?? products.find((p) => p.id === productId)?.priceMinor ?? 0;

  // Load the client's negotiated prices and re-seed existing product lines.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!v.clientId) {
        if (!cancelled) setPriceMap({});
        return;
      }
      try {
        const res = await fetch(`/api/pricing?clientId=${encodeURIComponent(v.clientId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { prices: Record<string, number> };
        if (cancelled) return;
        setPriceMap(data.prices);
        setRows((rs) => rs.map((r) => (r.productId && data.prices[r.productId] !== undefined ? { ...r, unitPrice: minorToInput(data.prices[r.productId], currency) } : r)));
      } catch {
        /* keep product defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.clientId]);

  const totals = useMemo(() => {
    const lines = rows.map((r) => ({
      quantityMilli: parseQuantityToMilli(r.quantity) ?? 0,
      unitPriceMinor: parseMoneyToMinor(r.unitPrice, currency) ?? 0,
    }));
    const discountMinor = parseMoneyToMinor(v.discount || "0", currency) ?? 0;
    const taxBps = parsePercentToBps(v.taxRate) ?? 0;
    const deliveryChargeMinor = parseMoneyToMinor(v.deliveryCharge || "0", currency) ?? 0;
    try {
      return { ...computeTotals({ lines, discountMinor, taxBps, deliveryChargeMinor }), error: null as string | null };
    } catch (err) {
      const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
      return { lineTotals: lines.map(lineTotal), subtotalMinor: subtotal, discountMinor, taxMinor: 0, deliveryChargeMinor, totalMinor: subtotal, error: (err as Error).message };
    }
  }, [rows, v.discount, v.taxRate, v.deliveryCharge, currency]);

  const payload = JSON.stringify({ ...v, items: rows.map(({ key: _k, ...r }) => r) });

  function addProduct(id: string) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setRows((r) => [...r, { key: nextKey++, productId: p.id, description: p.name, unit: p.unit, quantity: "1", unitPrice: minorToInput(priceFor(p.id), currency) }]);
    setPick("");
  }
  const addCustom = () => setRows((r) => [...r, { key: nextKey++, productId: null, description: "", unit: null, quantity: "1", unitPrice: "" }]);
  const updateRow = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeRow = (key: number) => setRows((r) => r.filter((x) => x.key !== key));

  const selectedClient = clients.find((c) => c.id === v.clientId);

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      {orderId && <input type="hidden" name="id" value={orderId} />}
      {state.error && <Alert tone="red">{state.error}</Alert>}

      <Card title="Client & schedule">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Client" htmlFor="clientId" error={e.clientId} className="md:col-span-2">
            <Select id="clientId" value={v.clientId} onChange={(ev) => set("clientId", ev.target.value)} invalid={!!e.clientId}>
              <option value="">Select a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
            </Select>
            <Link href="/app/clients/new?next=order" className="mt-1 inline-block text-xs text-brand-700 hover:underline">+ New client</Link>
          </Field>
          <Field label="Order date" htmlFor="orderDate" error={e.orderDate}>
            <Input id="orderDate" type="date" value={v.orderDate} onChange={(ev) => set("orderDate", ev.target.value)} invalid={!!e.orderDate} />
          </Field>
          <Field label="Pickup / delivery at" htmlFor="fulfillmentAt" error={e.fulfillmentAt}>
            <Input id="fulfillmentAt" type="datetime-local" value={v.fulfillmentAt} onChange={(ev) => set("fulfillmentAt", ev.target.value)} invalid={!!e.fulfillmentAt} />
          </Field>
          <Field label="Fulfilment" htmlFor="fulfillmentType">
            <Select
              id="fulfillmentType"
              value={v.fulfillmentType}
              onChange={(ev) => {
                const t = ev.target.value as "PICKUP" | "DELIVERY";
                set("fulfillmentType", t);
                if (t === "DELIVERY" && !v.deliveryAddress && selectedClient?.address) set("deliveryAddress", selectedClient.address);
              }}
            >
              <option value="PICKUP">Pickup</option>
              <option value="DELIVERY">Delivery</option>
            </Select>
          </Field>
          {v.fulfillmentType === "DELIVERY" && (
            <Field label="Delivery address" htmlFor="deliveryAddress" error={e.deliveryAddress} className="md:col-span-2 lg:col-span-3">
              <Textarea id="deliveryAddress" rows={2} value={v.deliveryAddress} onChange={(ev) => set("deliveryAddress", ev.target.value)} invalid={!!e.deliveryAddress} />
            </Field>
          )}
          {!orderId && (
            <Field label="Save as" htmlFor="status">
              <Select id="status" value={v.status ?? "CONFIRMED"} onChange={(ev) => set("status", ev.target.value as "DRAFT" | "CONFIRMED")}>
                <option value="CONFIRMED">Confirmed order</option>
                <option value="DRAFT">Draft / quote</option>
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card title="Items">
        {e.items && <Alert tone="red" className="mb-3">{e.items}</Alert>}
        <div className="space-y-3">
          {rows.length === 0 && <p className="py-4 text-center text-sm text-stone-500">No items yet. Add a product or a custom item below.</p>}
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-12 items-start gap-2 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
              <Field label={r.productId ? "Product" : "Custom item"} htmlFor={`d${r.key}`} error={e[`items.${i}.description`]} className="col-span-12 md:col-span-5">
                <Input id={`d${r.key}`} value={r.description} onChange={(ev) => updateRow(r.key, { description: ev.target.value })} placeholder="e.g. 2-tier chocolate cake, 'Happy Birthday Asha'" />
              </Field>
              <Field label="Qty" htmlFor={`q${r.key}`} error={e[`items.${i}.quantity`]} className="col-span-4 md:col-span-2">
                <div className="flex items-center gap-1">
                  <Input id={`q${r.key}`} inputMode="decimal" value={r.quantity} onChange={(ev) => updateRow(r.key, { quantity: ev.target.value })} invalid={!!e[`items.${i}.quantity`]} />
                  {r.unit && <span className="text-xs text-stone-500">{r.unit}</span>}
                </div>
              </Field>
              <Field label={`Unit price`} htmlFor={`p${r.key}`} error={e[`items.${i}.unitPrice`]} className="col-span-4 md:col-span-2">
                <Input id={`p${r.key}`} inputMode="decimal" value={r.unitPrice} onChange={(ev) => updateRow(r.key, { unitPrice: ev.target.value })} invalid={!!e[`items.${i}.unitPrice`]} />
              </Field>
              <div className="col-span-4 md:col-span-2">
                <p className="mb-1 text-sm font-medium text-stone-700">Line total</p>
                <p className="py-2 text-sm tabular-nums">{formatMoney(totals.lineTotals[i] ?? 0, currency)}</p>
              </div>
              <div className="col-span-12 flex justify-end md:col-span-1 md:pt-6">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(r.key)} aria-label={`Remove item ${i + 1}`}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select value={pick} onChange={(ev) => addProduct(ev.target.value)} className="w-auto max-w-xs" aria-label="Add product">
            <option value="">+ Add product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.category ? `${p.category} · ` : ""}{p.name} — {formatMoney(p.priceMinor, currency)}/{p.unit}</option>)}
          </Select>
          <Button type="button" variant="secondary" onClick={addCustom}>+ Custom item</Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Notes">
          <Textarea rows={5} value={v.notes} onChange={(ev) => set("notes", ev.target.value)} placeholder="Design, flavours, message on cake, allergies…" aria-label="Notes" />
        </Card>
        <Card title="Totals">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Discount" htmlFor="discount" error={e.discount || (totals.error?.includes("Discount") ? totals.error : undefined)}>
              <Input id="discount" inputMode="decimal" value={v.discount} onChange={(ev) => set("discount", ev.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Tax %" htmlFor="taxRate" error={e.taxRate}>
              <Input id="taxRate" inputMode="decimal" value={v.taxRate} onChange={(ev) => set("taxRate", ev.target.value)} placeholder="0" />
            </Field>
            <Field label="Delivery charge" htmlFor="deliveryCharge" error={e.deliveryCharge}>
              <Input id="deliveryCharge" inputMode="decimal" value={v.deliveryCharge} onChange={(ev) => set("deliveryCharge", ev.target.value)} placeholder="0.00" />
            </Field>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(totals.subtotalMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Discount</dt><dd className="tabular-nums">−{formatMoney(totals.discountMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Tax</dt><dd className="tabular-nums">{formatMoney(totals.taxMinor, currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Delivery</dt><dd className="tabular-nums">{formatMoney(totals.deliveryChargeMinor, currency)}</dd></div>
            <div className={cx("flex justify-between border-t border-stone-200 pt-2 text-base font-semibold", totals.error && "text-red-600")}>
              <dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.totalMinor, currency)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="flex gap-2">
        <SubmitButton pendingText="Saving order…">{orderId ? "Save order" : "Create order"}</SubmitButton>
        <ButtonLink href={orderId ? `/app/orders/${orderId}` : "/app/orders"} variant="ghost">Cancel</ButtonLink>
      </div>
    </form>
  );
}
