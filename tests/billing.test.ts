import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processStripeEvent, verifyStripeWebhook, type StripeEventLike } from "@/server/billing";
import { resetDb, setupBusiness } from "./helpers";

const SECRET = "whsec_test_secret";
let seq = 0;

function subEvent(type: string, sub: Record<string, unknown>, created = Math.floor(Date.now() / 1000)): StripeEventLike {
  return { id: `evt_${++seq}_${Date.now()}`, type, created, data: { object: { object: "subscription", ...sub } } };
}

async function linkedBusiness() {
  const b = await setupBusiness("Zeta Business", `owner${++seq}@zeta.test`);
  await prisma.subscription.update({ where: { businessId: b.businessId }, data: { stripeCustomerId: `cus_${b.businessId}` } });
  return b;
}

const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
const subPayload = (b: { businessId: string }, status: string, price = "price_pro_test") => ({
  id: `sub_${b.businessId}`,
  customer: `cus_${b.businessId}`,
  status,
  cancel_at_period_end: false,
  metadata: { businessId: b.businessId },
  items: { data: [{ current_period_end: periodEnd, price: { id: price } }] },
});

beforeEach(resetDb);

describe("webhook signature verification", () => {
  const payload = JSON.stringify({ id: "evt_sig", type: "customer.subscription.updated", created: 1, data: { object: {} } });
  const stripe = new Stripe("sk_test_dummy");

  it("accepts a correctly signed payload", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(verifyStripeWebhook(payload, header, SECRET).id).toBe("evt_sig");
  });
  it("rejects a bad signature, a tampered body and a missing header", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    expect(() => verifyStripeWebhook(payload, header, SECRET)).toThrow();
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(() => verifyStripeWebhook(payload.replace("evt_sig", "evt_evil"), good, SECRET)).toThrow();
    expect(() => verifyStripeWebhook(payload, null, SECRET)).toThrow();
  });
});

describe("webhook processing", () => {
  it("links checkout to the business and activates the subscription", async () => {
    const b = await setupBusiness("Eta", "eta@x.test");
    const r1 = await processStripeEvent({
      id: "evt_checkout_1", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_1", mode: "subscription", client_reference_id: b.businessId, customer: "cus_eta", subscription: "sub_eta" } },
    });
    expect(r1).toBe("processed");
    await processStripeEvent(subEvent("customer.subscription.created", { ...subPayload(b, "active", "price_starter_test"), id: "sub_eta", customer: "cus_eta" }));
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub).toMatchObject({ status: "ACTIVE", plan: "STARTER", stripeCustomerId: "cus_eta", stripeSubscriptionId: "sub_eta" });
    expect(sub.currentPeriodEnd?.getTime()).toBe(periodEnd * 1000);
  });

  it("is idempotent: a replayed event is applied once", async () => {
    const b = await linkedBusiness();
    const event = subEvent("customer.subscription.updated", subPayload(b, "active"));
    expect(await processStripeEvent(event)).toBe("processed");
    expect(await processStripeEvent(event)).toBe("duplicate");
    expect(await prisma.billingEvent.count({ where: { id: event.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: b.businessId, action: "subscription.changed" } })).toBe(1);
  });

  it("handles concurrent deliveries of the same event", async () => {
    const b = await linkedBusiness();
    const event = subEvent("customer.subscription.updated", subPayload(b, "active"));
    const results = await Promise.allSettled([processStripeEvent(event), processStripeEvent(event), processStripeEvent(event)]);
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<string>).value);
    expect(ok.filter((v) => v === "processed")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { businessId: b.businessId, action: "subscription.changed" } })).toBe(1);
  });

  it("maps past_due (with grace start), cancellation and plan changes", async () => {
    const b = await linkedBusiness();
    const t0 = Math.floor(Date.now() / 1000);
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "active"), t0));
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "past_due"), t0 + 10));
    let sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub.status).toBe("PAST_DUE");
    expect(sub.pastDueSince).not.toBeNull();
    const firstPastDue = sub.pastDueSince;
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "unpaid"), t0 + 20));
    sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub.pastDueSince).toEqual(firstPastDue); // grace period is not restarted
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "active", "price_starter_test"), t0 + 30));
    sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub).toMatchObject({ status: "ACTIVE", plan: "STARTER", pastDueSince: null });
    await processStripeEvent(subEvent("customer.subscription.deleted", subPayload(b, "canceled"), t0 + 40));
    sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub.status).toBe("CANCELED");
    expect(sub.canceledAt).not.toBeNull();
  });

  it("ignores out-of-order (stale) events", async () => {
    const b = await linkedBusiness();
    const t0 = Math.floor(Date.now() / 1000);
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "canceled"), t0 + 100));
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "active"), t0));
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: b.businessId } });
    expect(sub.status).toBe("CANCELED");
  });

  it("ignores events for unknown customers and unrelated event types", async () => {
    expect(
      await processStripeEvent(subEvent("customer.subscription.updated", { id: "sub_x", customer: "cus_unknown", status: "active", items: { data: [] } })),
    ).toBe("ignored");
    expect(await processStripeEvent({ id: "evt_other", type: "charge.succeeded", created: 1, data: { object: {} } })).toBe("ignored");
  });

  it("keeps SaaS billing separate from business customer payments", async () => {
    const b = await linkedBusiness();
    await processStripeEvent(subEvent("customer.subscription.updated", subPayload(b, "active")));
    expect(await prisma.payment.count()).toBe(0);
  });
});
