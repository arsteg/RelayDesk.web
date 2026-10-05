import { beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { createOrder } from "@/server/orders";
import { recordPayment, voidPayment } from "@/server/payments";
import { fulfilment, resetDb, seedOrder, setupBusiness, today } from "./helpers";

let owner: TenantContext;

beforeAll(async () => {
  await resetDb();
  const b = await setupBusiness("Sigma Sweets", "owner@sigma.test");
  owner = await b.ownerCtx();
});

describe("payment edge cases", () => {
  it("rejects a refund when nothing has been paid", async () => {
    const { order } = await seedOrder(owner);
    await expect(recordPayment(owner, order.id, { kind: "REFUND", amount: "100", paidOn: today(), method: "CASH" })).rejects.toThrow(/Refund exceeds the amount paid/);
  });

  it("allows recording a deposit against a draft order", async () => {
    const client = await createClient(owner, { name: "Draft Payer", phone: "9111111111" });
    const draft = await createOrder(owner, {
      clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP", status: "DRAFT",
      items: [{ description: "Tart", quantity: "1", unitPrice: "100" }],
    });
    const r = await recordPayment(owner, draft.id, { kind: "DEPOSIT", amount: "50", paidOn: today(), method: "UPI" });
    expect(r.order.paidMinor).toBe(5000);
    expect(r.order.paymentStatus).toBe("PARTIAL");
  });

  it("voids a deposit and restores the outstanding balance", async () => {
    const { order } = await seedOrder(owner);
    const { payment } = await recordPayment(owner, order.id, { kind: "DEPOSIT", amount: "300", paidOn: today(), method: "CASH" });
    const after = await voidPayment(owner, payment.id, "Recorded in error");
    expect(after.paidMinor).toBe(0);
    expect(after.paymentStatus).toBe("UNPAID");
  });

  it("restores the paid amount when a refund is voided", async () => {
    const { order } = await seedOrder(owner); // total 1000
    await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "1000", paidOn: today(), method: "CARD" });
    const { payment: refund, order: afterRefund } = await recordPayment(owner, order.id, { kind: "REFUND", amount: "300", paidOn: today(), method: "CARD" });
    expect(afterRefund.paidMinor).toBe(70000);
    const restored = await voidPayment(owner, refund.id, "Refund reversed");
    expect(restored.paidMinor).toBe(100000);
    expect(restored.paymentStatus).toBe("PAID");
  });

  it("accepts a payment dated today in the business timezone", async () => {
    const { order } = await seedOrder(owner);
    const r = await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "100", paidOn: today(), method: "CASH" });
    expect(r.order.paidMinor).toBe(10000);
  });
});
