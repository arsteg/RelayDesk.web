import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { changeOrderStatus, createOrder, getOrder, updateOrder } from "@/server/orders";
import { fulfilment, resetDb, seedOrder, setupBusiness, today } from "./helpers";

let owner: TenantContext;

beforeAll(async () => {
  await resetDb();
  const b = await setupBusiness("Omega Bakehouse", "owner@omega.test");
  owner = await b.ownerCtx();
});

async function draftOrder() {
  const client = await createClient(owner, { name: "Draft Client", phone: "9000000000" });
  return createOrder(owner, {
    clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP",
    status: "DRAFT",
    items: [{ description: "Tart", quantity: "1", unitPrice: "100" }],
  });
}

function editPayload(clientId: string, price = "100") {
  return { clientId, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "Edited item", quantity: "1", unitPrice: price }] };
}

describe("order status transitions", () => {
  it("rejects skipping straight from DRAFT to IN_PROGRESS but allows DRAFT->CONFIRMED", async () => {
    const d = await draftOrder();
    expect(d.status).toBe("DRAFT");
    await expect(changeOrderStatus(owner, d.id, "IN_PROGRESS")).rejects.toBeInstanceOf(ValidationError);
    const confirmed = await changeOrderStatus(owner, d.id, "CONFIRMED");
    expect(confirmed.status).toBe("CONFIRMED");
  });

  it("allows the backward READY->IN_PROGRESS step and blocks any exit from a final state", async () => {
    const { order } = await seedOrder(owner);
    await changeOrderStatus(owner, order.id, "READY");
    const back = await changeOrderStatus(owner, order.id, "IN_PROGRESS");
    expect(back.status).toBe("IN_PROGRESS");
    await changeOrderStatus(owner, order.id, "CANCELLED", "no longer needed");
    await expect(changeOrderStatus(owner, order.id, "CONFIRMED")).rejects.toBeInstanceOf(ValidationError);
  });

  it("treats a same-status change as a no-op with no audit entry", async () => {
    const { order } = await seedOrder(owner);
    const r = await changeOrderStatus(owner, order.id, "CONFIRMED");
    expect(r.status).toBe("CONFIRMED");
    const n = await prisma.auditLog.count({ where: { entityId: order.id, action: "order.status_changed" } });
    expect(n).toBe(0);
  });
});

describe("order editability", () => {
  it("permits editing orders still in progress and blocks cancelled ones", async () => {
    const editable = await seedOrder(owner);
    await changeOrderStatus(owner, editable.order.id, "READY");
    const updated = await updateOrder(owner, editable.order.id, editPayload(editable.client.id, "250"));
    expect(updated.totalMinor).toBe(25000);

    const cancelled = await seedOrder(owner);
    await changeOrderStatus(owner, cancelled.order.id, "CANCELLED", "customer cancelled");
    await expect(updateOrder(owner, cancelled.order.id, editPayload(cancelled.client.id))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("optimistic concurrency on edits", () => {
  it("rejects a stale expectedUpdatedAt and accepts the current one", async () => {
    const { order, client } = await seedOrder(owner);
    const full = await getOrder(owner, order.id);
    await expect(
      updateOrder(owner, order.id, { ...editPayload(client.id), expectedUpdatedAt: new Date(0).toISOString() }),
    ).rejects.toThrow(/Someone else changed this order/);
    const ok = await updateOrder(owner, order.id, { ...editPayload(client.id, "150"), expectedUpdatedAt: full.updatedAt.toISOString() });
    expect(ok.totalMinor).toBe(15000);
  });
});
