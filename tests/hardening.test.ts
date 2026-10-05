import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ReadOnlyError, ValidationError } from "@/lib/errors";
import { setEmailAdapter, type EmailAdapter } from "@/lib/email";
import { checkEnv } from "@/lib/env";
import { clientIpFromHeaders } from "@/lib/request-ip";
import { registerOwner } from "@/server/auth";
import { createClient } from "@/server/clients";
import { getDashboard } from "@/server/dashboard";
import { changeMemberRole, inviteMember } from "@/server/members";
import { createOrder, listOrders, updateOrder } from "@/server/orders";
import { recordPayment } from "@/server/payments";
import { createProduct } from "@/server/products";
import { updateLogo, updateSettings } from "@/server/settings";
import { mailbox } from "./setup";
import { ctx, fulfilment, resetDb, seedOrder, setupBusiness, today } from "./helpers";

const failingAdapter: EmailAdapter = { send: async () => { throw new Error("SMTP down"); } };

beforeEach(resetDb);
afterEach(() => setEmailAdapter(mailbox));

describe("client IP for rate limiting", () => {
  const h = (xff: string | null, real: string | null = null) => (n: string) => (n === "x-forwarded-for" ? xff : n === "x-real-ip" ? real : null);
  it("uses the entry appended by the trusted proxy, not the spoofable left-most one", () => {
    expect(clientIpFromHeaders(h("6.6.6.6, 203.0.113.9"), "1")).toBe("203.0.113.9");
    expect(clientIpFromHeaders(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), "2")).toBe("203.0.113.9");
  });
  it("ignores X-Forwarded-For when there is no trusted proxy", () => {
    expect(clientIpFromHeaders(h("6.6.6.6", "198.51.100.7"), "0")).toBe("198.51.100.7");
    expect(clientIpFromHeaders(h(null, null), "0")).toBe("unknown");
  });
});

describe("startup configuration check", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x", APP_URL: "https://bake.example", EMAIL_PROVIDER: "smtp", SMTP_URL: "smtp://x", EMAIL_FROM: "a@b.c", CRON_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv;
  it("accepts a complete production config", () => {
    expect(checkEnv(base).errors).toEqual([]);
  });
  it("fails on settings that would silently lose emails or break billing", () => {
    expect(checkEnv({ ...base, EMAIL_PROVIDER: "console" }).errors.join()).toMatch(/drop verification/);
    expect(checkEnv({ ...base, SMTP_URL: undefined }).errors.join()).toMatch(/SMTP_URL/);
    expect(checkEnv({ ...base, STRIPE_SECRET_KEY: "sk_live_x" }).errors.join()).toMatch(/STRIPE_WEBHOOK_SECRET/);
    expect(checkEnv({ ...base, APP_URL: undefined }).errors.join()).toMatch(/APP_URL/);
    expect(checkEnv({ ...base, TRUSTED_PROXY_HOPS: "two" }).errors.join()).toMatch(/TRUSTED_PROXY_HOPS/);
  });
  it("validates SES email config using the SES_AWS_ prefixed variables", () => {
    const ses = { ...base, EMAIL_PROVIDER: "ses", SMTP_URL: undefined } as NodeJS.ProcessEnv;
    expect(checkEnv(ses).errors.join()).toMatch(/SES_AWS_REGION/);
    const withRegion = { ...ses, SES_AWS_REGION: "ap-south-1" };
    expect(checkEnv(withRegion).errors).toEqual([]); // instance-role path: no explicit creds
    expect(checkEnv({ ...withRegion, SES_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE" }).errors.join()).toMatch(/both SES_AWS_ACCESS_KEY_ID and SES_AWS_SECRET_ACCESS_KEY/);
    expect(checkEnv({ ...withRegion, SES_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE", SES_AWS_SECRET_ACCESS_KEY: "secret" }).errors).toEqual([]);
  });
});

describe("input bounds", () => {
  it("rejects passwords bcrypt would truncate", async () => {
    await expect(registerOwner({ name: "A", email: "long@x.test", password: "é".repeat(40), businessName: "B" })).rejects.toThrow(/72 bytes/);
  });
  it("rejects names with control characters (email header safety)", async () => {
    await expect(registerOwner({ name: "Eve\r\nBcc: x@y.z", email: "ctl@x.test", password: "a-strong-password", businessName: "B" })).rejects.toThrow(/invalid characters/);
  });
  it("turns amounts beyond the INTEGER columns into validation errors, not database errors", async () => {
    const b = await setupBusiness("Bounds", "o@bounds.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Big" });
    const base = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const };
    await expect(createOrder(c, { ...base, items: [{ description: "x", quantity: "1", unitPrice: "99999999999" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(c, { ...base, items: [{ description: "x", quantity: "999", unitPrice: "9000000" }] })).rejects.toThrow(/larger than RelayDesk supports/);
    await expect(createProduct(c, { name: "x", unit: "pc", price: "50000000", isAvailable: true })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("refund permissions", () => {
  it("lets staff take payments but only owners/admins issue refunds", async () => {
    const b = await setupBusiness("Refunds", "o@refund.test");
    const staff = await (await b.addMember("s@refund.test", "STAFF")).ctx();
    const admin = await (await b.addMember("a@refund.test", "ADMIN")).ctx();
    const { order } = await seedOrder(await b.ownerCtx());
    await recordPayment(staff, order.id, { kind: "PAYMENT", amount: "100", paidOn: today(), method: "CASH" });
    await expect(recordPayment(staff, order.id, { kind: "REFUND", amount: "50", paidOn: today(), method: "CASH" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(admin, order.id, { kind: "REFUND", amount: "50", paidOn: today(), method: "CASH" })).resolves.toBeTruthy();
  });
});

describe("suspension blocks every write path", () => {
  it("rejects settings, logo and member changes by a suspended workspace's owner", async () => {
    const b = await setupBusiness("Suspended", "o@susp.test");
    const staff = await b.addMember("s@susp.test", "STAFF");
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: staff.user.id } });
    await prisma.business.update({ where: { id: b.businessId }, data: { suspendedAt: new Date(), suspendedReason: "test" } });
    const c = await b.ownerCtx();
    await expect(updateSettings(c, { name: "x", currency: "INR", timezone: "Asia/Kolkata", invoicePrefix: "" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(updateLogo(c, null)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(changeMemberRole(c, m.id, "ADMIN")).rejects.toBeInstanceOf(ReadOnlyError);
  });
});

describe("currency changes", () => {
  it("is allowed on an empty workspace and blocked once products or orders exist", async () => {
    const b = await setupBusiness("Currency", "o@cur.test");
    const c = await b.ownerCtx();
    const input = { name: "Currency", currency: "USD", timezone: "Asia/Kolkata", invoicePrefix: "" };
    await updateSettings(c, input);
    await createProduct(await ctx(b.owner.id, b.businessId), { name: "Bun", unit: "pc", price: "1", isAvailable: true });
    await expect(updateSettings(await ctx(b.owner.id, b.businessId), { ...input, currency: "EUR" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("email delivery failures do not break committed actions", () => {
  it("still registers the user when the verification email fails", async () => {
    setEmailAdapter(failingAdapter);
    const { user } = await registerOwner({ name: "Mail", email: "mail@x.test", password: "a-strong-password", businessName: "Mailless" });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });
  it("returns a shareable invite link when the invitation email fails", async () => {
    const b = await setupBusiness("Invites", "o@inv.test");
    setEmailAdapter(failingAdapter);
    const res = await inviteMember(await b.ownerCtx(), { email: "new@inv.test", role: "STAFF" });
    expect(res.emailSent).toBe(false);
    expect(res.inviteUrl).toContain(`/invite/${res.token}`);
  });
});

describe("orders", () => {
  it("rejects a stale edit instead of silently overwriting another user's changes", async () => {
    const b = await setupBusiness("Concurrency", "o@cc.test");
    const c = await b.ownerCtx();
    const { order, client } = await seedOrder(c);
    const input = { clientId: client.id, orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const, items: [{ description: "x", quantity: "1", unitPrice: "10" }] };
    const loadedAt = order.updatedAt.toISOString();
    await updateOrder(c, order.id, { ...input, expectedUpdatedAt: loadedAt }); // first editor wins
    await expect(updateOrder(c, order.id, { ...input, expectedUpdatedAt: loadedAt })).rejects.toThrow(/Someone else changed this order/);
  });
  it("never reports draft quotes as overdue", async () => {
    const b = await setupBusiness("Drafts", "o@dr.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Q" });
    const past = `${today()}T00:00`;
    await createOrder(c, { clientId: client.id, orderDate: today(), fulfillmentAt: past, fulfillmentType: "PICKUP", status: "DRAFT", items: [{ description: "Quote", quantity: "1", unitPrice: "10" }] });
    await createOrder(c, { clientId: client.id, orderDate: today(), fulfillmentAt: past, fulfillmentType: "PICKUP", items: [{ description: "Real", quantity: "1", unitPrice: "10" }] });
    expect((await getDashboard(c)).overdueCount).toBe(1);
    expect((await listOrders(c, { status: "OVERDUE" })).total).toBe(1);
  });
});
