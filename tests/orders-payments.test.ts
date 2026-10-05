import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { createProduct, updateProduct } from "@/server/products";
import { changeOrderStatus, createOrder, getOrder, listOrders, updateOrder } from "@/server/orders";
import { recordPayment, voidPayment } from "@/server/payments";
import { fulfilment, resetDb, seedOrder, setupBusiness, today } from "./helpers";

let owner: TenantContext;

beforeAll(async () => {
  await resetDb();
  const b = await setupBusiness("Delta Patisserie", "owner@delta.test");
  owner = await b.ownerCtx();
});

describe("orders", () => {
  it("stores computed totals and sequential business-scoped numbers", async () => {
    const client = await createClient(owner, { name: "Asha" });
    const o1 = await createOrder(owner, {
      clientId: client.id,
      orderDate: today(),
      fulfillmentAt: fulfilment(2),
      fulfillmentType: "DELIVERY",
      deliveryAddress: "12 MG Road",
      discount: "100",
      taxRate: "5",
      deliveryCharge: "50",
      items: [
        { description: "Custom wedding cake (3 tier)", quantity: "1", unitPrice: "4500" },
        { description: "Cupcakes", quantity: "12", unitPrice: "60.50" },
      ],
    });
    // subtotal 4500 + 726 = 5226; taxable 5126; tax 256.30; total 5126 + 256.30 + 50 = 5432.30
    expect(o1.subtotalMinor).toBe(522600);
    expect(o1.taxMinor).toBe(25630);
    expect(o1.totalMinor).toBe(543230);
    expect(o1.paymentStatus).toBe("UNPAID");
    const o2 = await createOrder(owner, {
      clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP",
      items: [{ description: "Bread", quantity: "1", unitPrice: "40" }],
    });
    expect(o2.number).toBe(o1.number + 1);
    const items = await prisma.orderItem.findMany({ where: { orderId: o1.id } });
    expect(items.every((i) => i.isCustom && i.businessId === owner.businessId)).toBe(true);
  });

  it("requires a delivery address for deliveries and rejects discounts above subtotal", async () => {
    const client = await createClient(owner, { name: "Ravi" });
    const base = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] };
    await expect(createOrder(owner, { ...base, fulfillmentType: "DELIVERY" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(owner, { ...base, fulfillmentType: "PICKUP", discount: "11" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(owner, { ...base, fulfillmentType: "PICKUP", items: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("preserves purchased item descriptions and prices when the product changes", async () => {
    const product = await createProduct(owner, { name: "Black Forest 1kg", unit: "kg", price: "900", isAvailable: true });
    const { order } = await seedOrder(owner, {});
    const client = (await getOrder(owner, order.id)).client;
    const o = await createOrder(owner, {
      clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP",
      items: [{ productId: product.id, description: product.name, unit: "kg", quantity: "1.5", unitPrice: "900" }],
    });
    await updateProduct(owner, product.id, { name: "Black Forest Deluxe", unit: "kg", price: "1200", isAvailable: true });
    const after = await getOrder(owner, o.id);
    expect(after.items[0].description).toBe("Black Forest 1kg");
    expect(after.items[0].unitPriceMinor).toBe(90000);
    expect(after.items[0].lineTotalMinor).toBe(135000);
    expect(after.totalMinor).toBe(135000);
  });

  it("enforces status transitions and locks completed orders", async () => {
    const { order } = await seedOrder(owner);
    await changeOrderStatus(owner, order.id, "IN_PROGRESS");
    await changeOrderStatus(owner, order.id, "READY");
    await changeOrderStatus(owner, order.id, "COMPLETED");
    await expect(changeOrderStatus(owner, order.id, "CANCELLED")).rejects.toBeInstanceOf(ValidationError);
    const full = await getOrder(owner, order.id);
    await expect(
      updateOrder(owner, order.id, {
        clientId: full.clientId, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP",
        items: [{ description: "x", quantity: "1", unitPrice: "1" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const audits = await prisma.auditLog.count({ where: { entityId: order.id, action: "order.status_changed" } });
    expect(audits).toBe(3);
  });

  it("filters by status, payment status and client", async () => {
    const { order, client } = await seedOrder(owner);
    await recordPayment(owner, order.id, { kind: "DEPOSIT", amount: "200", paidOn: today(), method: "UPI" });
    const partial = await listOrders(owner, { paymentStatus: "PARTIAL", clientId: client.id });
    expect(partial.rows.map((o) => o.id)).toEqual([order.id]);
    const confirmed = await listOrders(owner, { status: "CONFIRMED", clientId: client.id });
    expect(confirmed.total).toBe(1);
    expect((await listOrders(owner, { status: "COMPLETED", clientId: client.id })).total).toBe(0);
  });
});

describe("payments and refunds", () => {
  it("tracks deposits, partial and full payment", async () => {
    const { order } = await seedOrder(owner); // total 1000.00
    let r = await recordPayment(owner, order.id, { kind: "DEPOSIT", amount: "300", paidOn: today(), method: "UPI", reference: "UPI123" });
    expect(r.order.paidMinor).toBe(30000);
    expect(r.order.paymentStatus).toBe("PARTIAL");
    r = await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "700", paidOn: today(), method: "CASH" });
    expect(r.order.paidMinor).toBe(100000);
    expect(r.order.paymentStatus).toBe("PAID");
  });

  it("rejects overpayments, zero amounts and future dates", async () => {
    const { order } = await seedOrder(owner);
    await recordPayment(owner, order.id, { kind: "DEPOSIT", amount: "900", paidOn: today(), method: "CASH" });
    await expect(recordPayment(owner, order.id, { kind: "PAYMENT", amount: "100.01", paidOn: today(), method: "CASH" })).rejects.toThrow(/outstanding balance/);
    await expect(recordPayment(owner, order.id, { kind: "PAYMENT", amount: "0", paidOn: today(), method: "CASH" })).rejects.toBeInstanceOf(ValidationError);
    await expect(recordPayment(owner, order.id, { kind: "PAYMENT", amount: "1", paidOn: "2999-01-01", method: "CASH" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("validates refunds against the amount paid", async () => {
    const { order } = await seedOrder(owner);
    await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "1000", paidOn: today(), method: "CARD" });
    await expect(recordPayment(owner, order.id, { kind: "REFUND", amount: "1000.01", paidOn: today(), method: "CARD" })).rejects.toThrow(/Refund exceeds/);
    const r = await recordPayment(owner, order.id, { kind: "REFUND", amount: "250", paidOn: today(), method: "CARD" });
    expect(r.order.paidMinor).toBe(75000);
    expect(r.order.paymentStatus).toBe("PARTIAL");
  });

  it("marks cancelled orders with payments as refund due, and blocks new payments on them", async () => {
    const { order } = await seedOrder(owner);
    await recordPayment(owner, order.id, { kind: "DEPOSIT", amount: "400", paidOn: today(), method: "CASH" });
    const cancelled = await changeOrderStatus(owner, order.id, "CANCELLED", "Customer cancelled");
    expect(cancelled.paymentStatus).toBe("OVERPAID");
    await expect(recordPayment(owner, order.id, { kind: "PAYMENT", amount: "1", paidOn: today(), method: "CASH" })).rejects.toThrow(/cancelled/);
    const r = await recordPayment(owner, order.id, { kind: "REFUND", amount: "400", paidOn: today(), method: "CASH" });
    expect(r.order.paidMinor).toBe(0);
    expect(r.order.paymentStatus).toBe("PAID"); // settled: nothing due, nothing held
  });

  it("flags overpayment when an order total is reduced below the amount paid", async () => {
    const { order, client } = await seedOrder(owner);
    await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "1000", paidOn: today(), method: "CASH" });
    const updated = await updateOrder(owner, order.id, {
      clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP",
      items: [{ description: "Smaller cake", quantity: "1", unitPrice: "600" }],
    });
    expect(updated.paymentStatus).toBe("OVERPAID");
  });

  it("corrects payments by voiding with an audit trail rather than editing", async () => {
    const { order } = await seedOrder(owner);
    const { payment } = await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "500", paidOn: today(), method: "CASH" });
    await expect(voidPayment(owner, payment.id, "")).rejects.toBeInstanceOf(ValidationError);
    const after = await voidPayment(owner, payment.id, "Recorded against wrong order");
    expect(after.paidMinor).toBe(0);
    expect(after.paymentStatus).toBe("UNPAID");
    await expect(voidPayment(owner, payment.id, "again")).rejects.toThrow(/already been voided/);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.voidedAt).not.toBeNull();
    expect(row.amountMinor).toBe(50000); // original amount preserved
    const actions = (await prisma.auditLog.findMany({ where: { entityId: payment.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["payment.recorded", "payment.voided"]);
  });

  it("will not void a payment if that leaves more refunded than paid", async () => {
    const { order } = await seedOrder(owner);
    const { payment } = await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "500", paidOn: today(), method: "CASH" });
    await recordPayment(owner, order.id, { kind: "REFUND", amount: "200", paidOn: today(), method: "CASH" });
    await expect(voidPayment(owner, payment.id, "mistake")).rejects.toThrow(/Void the related refund first/);
  });

  it("serialises concurrent payments so the balance cannot be exceeded", async () => {
    const { order } = await seedOrder(owner); // 1000.00
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => recordPayment(owner, order.id, { kind: "PAYMENT", amount: "400", paidOn: today(), method: "CASH" })),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(2);
    const final = await getOrder(owner, order.id);
    expect(final.paidMinor).toBe(80000);
  });
});
