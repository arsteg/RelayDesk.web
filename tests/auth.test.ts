import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import {
  acceptInvitation, authenticate, findUsableInvitation, registerInvitedUser, registerOwner, requestPasswordReset, resetPassword, updateDisplayName, verifyEmail,
} from "@/server/auth";
import { inviteMember } from "@/server/members";
import { mailbox } from "./setup";
import { createUser, resetDb, setupBusiness } from "./helpers";

const tokenFrom = (text: string, marker: string) => decodeURIComponent(text.split(marker)[1].split(/\s/)[0]);

beforeEach(async () => {
  await resetDb();
  mailbox.sent = [];
});

describe("registration and email verification", () => {
  it("registers an owner with a trialing workspace and a single-use verification link", async () => {
    const { user, businessId } = await registerOwner({ name: "Priya", email: "Priya@Example.test", password: "a-strong-password", businessName: "Priya's Bakes" });
    expect(user.email).toBe("priya@example.test");
    expect(user.emailVerifiedAt).toBeNull();
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(m).toMatchObject({ businessId, role: "OWNER" });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(sub.status).toBe("TRIALING");
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(business).toMatchObject({ currency: "INR", timezone: "Asia/Kolkata" });

    const token = tokenFrom(mailbox.sent[0].text, "token=");
    expect(await verifyEmail(token)).toBe(true);
    expect(await verifyEmail(token)).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    // Only the hash is stored.
    expect(await prisma.authToken.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    await registerOwner({ name: "A", email: "a@x.test", password: "a-strong-password", businessName: "A" });
    await expect(registerOwner({ name: "A", email: "A@x.test", password: "a-strong-password", businessName: "B" })).rejects.toBeInstanceOf(ValidationError);
    await expect(registerOwner({ name: "B", email: "b@x.test", password: "short", businessName: "B" })).rejects.toThrow();
  });

  it("authenticates only with the right password", async () => {
    await createUser("c@x.test");
    expect(await authenticate("c@x.test", "correct horse battery")).toBeTruthy();
    expect(await authenticate("C@X.test", "correct horse battery")).toBeTruthy();
    expect(await authenticate("c@x.test", "wrong")).toBeNull();
    expect(await authenticate("nobody@x.test", "correct horse battery")).toBeNull();
  });
});

describe("display name", () => {
  it("updates a trimmed name, audits it, and rejects blank or multi-line names", async () => {
    const u = await createUser("named@x.test");
    await updateDisplayName(u.id, "  Rafi  ");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name).toBe("Rafi");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.profile_updated", entityId: u.id } });
    expect(log.metadata).toMatchObject({ name: { from: "named", to: "Rafi" } });
    await expect(updateDisplayName(u.id, "   ")).rejects.toThrow();
    await expect(updateDisplayName(u.id, "Line\nbreak")).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).name).toBe("Rafi");
  });
});

describe("password reset", () => {
  it("resets the password once and signs out all sessions", async () => {
    const user = await createUser("d@x.test");
    await prisma.session.create({ data: { tokenHash: "h1", userId: user.id, expiresAt: new Date(Date.now() + 1e9) } });
    await requestPasswordReset("d@x.test");
    await requestPasswordReset("unknown@x.test"); // silently ignored
    expect(mailbox.sent).toHaveLength(1);
    const token = tokenFrom(mailbox.sent[0].text, "token=");
    expect(await resetPassword(token, "brand-new-password")).toBe(true);
    expect(await resetPassword(token, "another-password")).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await authenticate("d@x.test", "brand-new-password")).toBeTruthy();
  });
});

describe("invitations", () => {
  it("lets the invited email join, and refuses other accounts", async () => {
    const b = await setupBusiness("Theta", "owner@theta.test");
    const { token } = await inviteMember(await b.ownerCtx(), { email: "joiner@theta.test", role: "STAFF" });
    const stranger = await createUser("stranger@x.test");
    await expect(acceptInvitation(token, stranger.id)).rejects.toThrow(/sent to joiner@theta.test/);
    const { user } = await registerInvitedUser({ name: "Joiner", password: "a-strong-password", inviteToken: token });
    expect(user.emailVerifiedAt).not.toBeNull();
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(m).toMatchObject({ businessId: b.businessId, role: "STAFF" });
    expect(await findUsableInvitation(token)).toBeNull();
  });

  it("supports users who belong to multiple businesses", async () => {
    const b1 = await setupBusiness("Iota", "owner@iota.test");
    const b2 = await setupBusiness("Kappa", "owner@kappa.test");
    const { token } = await inviteMember(await b2.ownerCtx(), { email: "owner@iota.test", role: "ADMIN" });
    await acceptInvitation(token, b1.owner.id);
    const memberships = await prisma.membership.findMany({ where: { userId: b1.owner.id } });
    expect(memberships.map((m) => m.role).sort()).toEqual(["ADMIN", "OWNER"]);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within the window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await rateLimit("test:key", 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect((await rateLimit("test:other", 3, 60)).allowed).toBe(true);
  });
});
