import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { createProduct } from "@/server/products";
import { createOrder, getOrder } from "@/server/orders";
import { recordPayment } from "@/server/payments";
import { listCustomerPrices, resolvePricesForClient, setCustomerPrice } from "@/server/pricing";
import { captureLine } from "@/server/preparation";
import { recordShortfall, recordNotDelivered, listAdjustments } from "@/server/adjustments";
import { getReconciliation, reconcileDay } from "@/server/payments";
import { fulfilment, resetDb, setupBusiness, today } from "./helpers";

let owner: TenantContext;

beforeEach(async () => {
  await resetDb();
  const b = await setupBusiness("Acme Supply", "owner@acme.test");
  owner = await b.ownerCtx();
});

async function variableProduct(name = "Loose goods") {
  return createProduct(owner, { name, unit: "kg", price: "100", isAvailable: true, isVariableMeasure: true, orderUnits: ["kg", "pcs"] });
}

async function firstItem(orderId: string) {
  const it = await prisma.orderItem.findFirst({ where: { businessId: owner.businessId, orderId } });
  if (!it) throw new Error("no item");
  return it;
}

describe("per-customer pricing", () => {
  it("resolves a customer price over the product default, and clears it", async () => {
    const client = await createClient(owner, { name: "Priya", phone: "90000" });
    const product = await createProduct(owner, { name: "Widget", unit: "kg", price: "100", isAvailable: true });

    // default resolves to the product price
    let prices = await resolvePricesForClient(prisma, owner.businessId, client.id, [{ id: product.id, priceMinor: 10000 }]);
    expect(prices.get(product.id)).toBe(10000);

    await setCustomerPrice(owner, client.id, product.id, "85");
    prices = await resolvePricesForClient(prisma, owner.businessId, client.id, [{ id: product.id, priceMinor: 10000 }]);
    expect(prices.get(product.id)).toBe(8500);

    const list = await listCustomerPrices(owner, client.id);
    const row = list.rows.find((r) => r.productId === product.id)!;
    expect(row.customPriceMinor).toBe(8500);
    expect(row.effectivePriceMinor).toBe(8500);

    await setCustomerPrice(owner, client.id, product.id, "");
    prices = await resolvePricesForClient(prisma, owner.businessId, client.id, [{ id: product.id, priceMinor: 10000 }]);
    expect(prices.get(product.id)).toBe(10000);
  });
});

describe("variable-measure capture", () => {
  it("sets the billed quantity to net (gross − tare) and re-prices the order", async () => {
    const client = await createClient(owner, { name: "Rohan", phone: "90001" });
    const product = await variableProduct();
    // Order 50 'pcs' at ₹100/kg; provisional qty 50 until weighed.
    const order = await createOrder(owner, {
      clientId: client.id,
      orderDate: today(),
      fulfillmentAt: fulfilment(),
      fulfillmentType: "PICKUP",
      items: [{ productId: product.id, description: product.name, unit: "kg", quantity: "50", unitPrice: "100" }],
    });
    const item = await firstItem(order.id);

    // Three crates: gross 10/10/5 kg, tare 2/2/1 kg -> net 20 kg.
    const res = await captureLine(owner, item.id, { captures: [
      { gross: "10", tare: "2" },
      { gross: "10", tare: "2" },
      { gross: "5", tare: "1" },
    ] });
    expect(res.netMilli).toBe(20000);

    const after = await getOrder(owner, order.id);
    const line = after.items[0];
    expect(line.quantityMilli).toBe(20000); // 20 kg billed
    expect(line.lineTotalMinor).toBe(2000000); // 20 kg * ₹100 = ₹2000.00
    expect(after.totalMinor).toBe(2000000);
    expect(after.status).toBe("IN_PROGRESS"); // advanced from CONFIRMED on first capture
  });

  it("rejects captures whose tare exceeds gross (non-positive net)", async () => {
    const client = await createClient(owner, { name: "X", phone: "1" });
    const product = await variableProduct("Mince");
    const order = await createOrder(owner, { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP", items: [{ productId: product.id, description: product.name, unit: "kg", quantity: "5", unitPrice: "100" }] });
    const item = await firstItem(order.id);
    await expect(captureLine(owner, item.id, { captures: [{ gross: "2", tare: "3" }] })).rejects.toThrow();
  });
});

describe("delivery / receipt adjustments", () => {
  it("shortfall reduces a line to the received amount and re-prices", async () => {
    const client = await createClient(owner, { name: "Cafe", phone: "90002" });
    const product = await variableProduct("Chops");
    const order = await createOrder(owner, { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP", items: [{ productId: product.id, description: product.name, unit: "kg", quantity: "10", unitPrice: "100" }] });
    const item = await firstItem(order.id);

    // Higher-or-equal received is ignored.
    const noop = await recordShortfall(owner, item.id, "12", "verified at door");
    expect(noop.changed).toBe(false);

    const done = await recordShortfall(owner, item.id, "8", "short on arrival");
    expect(done.changed).toBe(true);
    const after = await getOrder(owner, order.id);
    expect(after.items[0].quantityMilli).toBe(8000);
    expect(after.totalMinor).toBe(800000); // 8 kg * ₹100

    const adj = await listAdjustments(owner, order.id);
    expect(adj[0].type).toBe("SHORTFALL");
    expect(adj[0].toQtyMilli).toBe(8000);
  });

  it("not-delivered removes the line from the invoice", async () => {
    const client = await createClient(owner, { name: "Hotel", phone: "90003" });
    const p1 = await createProduct(owner, { name: "A", unit: "box", price: "100", isAvailable: true });
    const p2 = await createProduct(owner, { name: "B", unit: "box", price: "50", isAvailable: true });
    const order = await createOrder(owner, { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP", items: [
      { productId: p1.id, description: "A", quantity: "1", unitPrice: "100" },
      { productId: p2.id, description: "B", quantity: "1", unitPrice: "50" },
    ] });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { position: "asc" } });
    await recordNotDelivered(owner, items[1].id, "left at depot");
    const after = await getOrder(owner, order.id);
    expect(after.items).toHaveLength(1);
    expect(after.totalMinor).toBe(10000); // only A remains
    const adj = await listAdjustments(owner, order.id);
    expect(adj[0].type).toBe("NOT_DELIVERED");
  });
});

describe("reconciliation", () => {
  it("sums expected vs collected for a day and marks reconciled", async () => {
    const client = await createClient(owner, { name: "Daily", phone: "90004" });
    const product = await createProduct(owner, { name: "Pack", unit: "box", price: "100", isAvailable: true });
    const order = await createOrder(owner, { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(0), fulfillmentType: "PICKUP", items: [{ productId: product.id, description: "Pack", quantity: "1", unitPrice: "100" }] });
    await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "60", paidOn: today(), method: "CASH" });

    const r = await getReconciliation(owner, today());
    expect(r.expectedMinor).toBe(10000);
    expect(r.collectedMinor).toBe(6000);
    expect(r.differenceMinor).toBe(4000);
    expect(r.byMethod.find((m) => m.method === "CASH")?.amountMinor).toBe(6000);
    expect(r.unreconciled).toBe(1);

    const marked = await reconcileDay(owner, today());
    expect(marked.count).toBe(1);
    const r2 = await getReconciliation(owner, today());
    expect(r2.unreconciled).toBe(0);
  });
});
