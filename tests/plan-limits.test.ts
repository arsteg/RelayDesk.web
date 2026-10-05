import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PlanLimitError, ReadOnlyError } from "@/lib/errors";
import { computeAccess } from "@/lib/plans";
import { createOrder } from "@/server/orders";
import { createClient } from "@/server/clients";
import { inviteMember, revokeInvitation } from "@/server/members";
import { exportCsv } from "@/server/exports";
import { listOrders } from "@/server/orders";
import { fulfilment, resetDb, setupBusiness, today } from "./helpers";

const DAY = 86400_000;

async function starterBusiness(email: string) {
  const b = await setupBusiness("Epsilon Bakes", email);
  await prisma.subscription.update({ where: { businessId: b.businessId }, data: { plan: "STARTER", status: "ACTIVE" } });
  return b;
}

beforeEach(async () => {
  await resetDb();
  process.env.PLAN_STARTER_MAX_MONTHLY_ORDERS = "2";
  process.env.PLAN_STARTER_MAX_MEMBERS = "3";
});
afterEach(() => {
  delete process.env.PLAN_STARTER_MAX_MONTHLY_ORDERS;
  delete process.env.PLAN_STARTER_MAX_MEMBERS;
});

describe("plan limits", () => {
  it("enforces the monthly order limit with an upgrade message", async () => {
    const b = await starterBusiness("o1@eps.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Mina" });
    const input = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] };
    await createOrder(c, input);
    await createOrder(c, input);
    const err = await createOrder(c, input).catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect(err.message).toMatch(/Upgrade to Pro/);
    // The failed attempt must not consume an order number.
    const business = await prisma.business.findUniqueOrThrow({ where: { id: b.businessId } });
    expect(business.orderSequence).toBe(2);
  });

  it("does not count orders from a previous month", async () => {
    const b = await starterBusiness("o2@eps.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Mina" });
    const input = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] };
    const old = await createOrder(c, input);
    await createOrder(c, input);
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 40 * DAY) } });
    await expect(createOrder(c, input)).resolves.toBeTruthy();
  });

  it("has no monthly order limit on Pro", async () => {
    const b = await starterBusiness("o3@eps.test");
    await prisma.subscription.update({ where: { businessId: b.businessId }, data: { plan: "PRO" } });
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Mina" });
    const input = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] };
    for (let i = 0; i < 4; i++) await createOrder(c, input);
  });

  it("counts members plus pending invitations against the staff limit", async () => {
    const b = await starterBusiness("o4@eps.test");
    const c = await b.ownerCtx(); // owner = 1 seat
    await inviteMember(c, { email: "s1@eps.test", role: "STAFF" });
    const { invitation } = await inviteMember(c, { email: "s2@eps.test", role: "STAFF" });
    const err = await inviteMember(c, { email: "s3@eps.test", role: "STAFF" }).catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitError);
    expect(err.message).toMatch(/Upgrade to Pro/);
    await revokeInvitation(c, invitation.id);
    await expect(inviteMember(c, { email: "s3@eps.test", role: "STAFF" })).resolves.toBeTruthy();
  });
});

describe("subscription states and access", () => {
  const now = new Date("2026-10-02T00:00:00Z");
  const base = { plan: "STARTER" as const, trialEndsAt: null, currentPeriodEnd: null, pastDueSince: null };
  const open = { suspendedAt: null };

  it("trial: full until it ends, then read-only", () => {
    expect(computeAccess({ ...base, status: "TRIALING", trialEndsAt: new Date(now.getTime() + DAY) }, open, now).level).toBe("full");
    expect(computeAccess({ ...base, status: "TRIALING", trialEndsAt: new Date(now.getTime() - DAY) }, open, now).level).toBe("readonly");
  });
  it("past due: full during the grace period, then read-only", () => {
    expect(computeAccess({ ...base, status: "PAST_DUE", pastDueSince: new Date(now.getTime() - 2 * DAY) }, open, now)).toMatchObject({ level: "full", warning: expect.any(String) });
    expect(computeAccess({ ...base, status: "PAST_DUE", pastDueSince: new Date(now.getTime() - 8 * DAY) }, open, now).level).toBe("readonly");
  });
  it("cancelled: full until the paid period ends, then read-only", () => {
    expect(computeAccess({ ...base, status: "CANCELED", currentPeriodEnd: new Date(now.getTime() + DAY) }, open, now).level).toBe("full");
    expect(computeAccess({ ...base, status: "CANCELED", currentPeriodEnd: new Date(now.getTime() - DAY) }, open, now).level).toBe("readonly");
  });
  it("suspension overrides everything", () => {
    expect(computeAccess({ ...base, status: "ACTIVE" }, { suspendedAt: now }, now).level).toBe("suspended");
  });

  it("read-only workspaces keep records and exports but block new business data", async () => {
    const b = await starterBusiness("o5@eps.test");
    const c0 = await b.ownerCtx();
    const client = await createClient(c0, { name: "Kept Client" });
    await createOrder(c0, { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP", items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] });
    await prisma.subscription.update({ where: { businessId: b.businessId }, data: { status: "CANCELED", currentPeriodEnd: new Date(Date.now() - DAY) } });
    const c = await b.ownerCtx();
    expect(c.access.level).toBe("readonly");
    await expect(createClient(c, { name: "New" })).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await listOrders(c)).total).toBe(1);
    expect(await exportCsv(c, "clients")).toContain("Kept Client");
  });
});

describe("billing disabled", () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = "false";
  });
  afterEach(() => {
    process.env.BILLING_ENABLED = "true";
  });

  it("gives full access without a subscription or after an expired trial, but still honours suspension", () => {
    const expired = { plan: "PRO" as const, status: "TRIALING" as const, trialEndsAt: new Date(Date.now() - DAY), currentPeriodEnd: null, pastDueSince: null };
    expect(computeAccess(null, { suspendedAt: null }).level).toBe("full");
    expect(computeAccess(expired, { suspendedAt: null })).toEqual({ level: "full", reason: null, warning: null });
    expect(computeAccess(expired, { suspendedAt: new Date() }).level).toBe("suspended");
  });

  it("does not enforce plan limits", async () => {
    const b = await starterBusiness("o9@eps.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Mina" });
    const input = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "Bun", quantity: "1", unitPrice: "10" }] };
    for (let i = 0; i < 3; i++) await createOrder(c, input);
    for (const email of ["s1@eps.test", "s2@eps.test", "s3@eps.test"]) await inviteMember(c, { email, role: "STAFF" });
    expect(await prisma.order.count({ where: { businessId: b.businessId } })).toBe(3);
  });
});
