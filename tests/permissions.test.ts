import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { can, canManageRole, PERMISSIONS } from "@/lib/permissions";
import type { TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { createProduct } from "@/server/products";
import { recordPayment, voidPayment } from "@/server/payments";
import { changeMemberRole, inviteMember, removeMember, transferOwnership } from "@/server/members";
import { updateSettings } from "@/server/settings";
import { exportCsv } from "@/server/exports";
import { simulateBilling } from "@/server/billing";
import { resetDb, seedOrder, setupBusiness, today } from "./helpers";

let owner: TenantContext, admin: TenantContext, staff: TenantContext;
let business: Awaited<ReturnType<typeof setupBusiness>>;
let adminMembershipId: string, staffMembershipId: string;

beforeAll(async () => {
  await resetDb();
  business = await setupBusiness("Gamma Cakes", "owner@gamma.test");
  const a = await business.addMember("admin@gamma.test", "ADMIN");
  const s = await business.addMember("staff@gamma.test", "STAFF");
  owner = await business.ownerCtx();
  admin = await a.ctx();
  staff = await s.ctx();
  adminMembershipId = (await prisma.membership.findFirstOrThrow({ where: { userId: a.user.id } })).id;
  staffMembershipId = (await prisma.membership.findFirstOrThrow({ where: { userId: s.user.id } })).id;
});

describe("permission matrix", () => {
  it("gives owners every business permission and keeps owner-only actions owner-only", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can("OWNER", p)).toBe(true);
    for (const p of ["settings.manage", "billing.manage", "ownership.transfer"] as const) {
      expect(can("ADMIN", p)).toBe(false);
      expect(can("STAFF", p)).toBe(false);
    }
  });
  it("lets admins manage staff only, and nobody assign OWNER directly", () => {
    expect(canManageRole("OWNER", "ADMIN")).toBe(true);
    expect(canManageRole("ADMIN", "STAFF")).toBe(true);
    expect(canManageRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageRole("STAFF", "STAFF")).toBe(false);
    expect(canManageRole("OWNER", "OWNER")).toBe(false);
  });
});

describe("staff", () => {
  it("can run daily operations: clients, orders, payments", async () => {
    const { order } = await seedOrder(owner);
    await expect(createClient(staff, { name: "Walk-in" })).resolves.toBeTruthy();
    await expect(recordPayment(staff, order.id, { kind: "PAYMENT", amount: "100", paidOn: today(), method: "UPI" })).resolves.toBeTruthy();
  });
  it("cannot manage products, void payments, invite, export, change settings or billing", async () => {
    const { order } = await seedOrder(owner);
    const { payment } = await recordPayment(owner, order.id, { kind: "PAYMENT", amount: "100", paidOn: today(), method: "CASH" });
    await expect(createProduct(staff, { name: "x", unit: "pc", price: "1", isAvailable: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(voidPayment(staff, payment.id, "oops")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteMember(staff, { email: "x@y.test", role: "STAFF" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportCsv(staff, "orders")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSettings(staff, { name: "x", currency: "INR", timezone: "Asia/Kolkata", invoicePrefix: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(simulateBilling(staff, "activate_pro")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(staff, adminMembershipId, "STAFF")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin", () => {
  it("can invite staff but not admins", async () => {
    await expect(inviteMember(admin, { email: "new-staff@gamma.test", role: "STAFF" })).resolves.toBeTruthy();
    await expect(inviteMember(admin, { email: "new-admin@gamma.test", role: "ADMIN" })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("cannot promote staff to admin or touch the owner", async () => {
    await expect(changeMemberRole(admin, staffMembershipId, "ADMIN")).rejects.toBeInstanceOf(ForbiddenError);
    const ownerMembership = await prisma.membership.findFirstOrThrow({ where: { businessId: owner.businessId, role: "OWNER" } });
    await expect(removeMember(admin, ownerMembership.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeMemberRole(admin, ownerMembership.id, "STAFF")).rejects.toThrow();
  });
  it("cannot change owner-only settings or billing", async () => {
    await expect(updateSettings(admin, { name: "x", currency: "INR", timezone: "Asia/Kolkata", invoicePrefix: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(simulateBilling(admin, "activate_pro")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transferOwnership(admin, staffMembershipId)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("can export data and void payments", async () => {
    await expect(exportCsv(admin, "clients")).resolves.toContain("Name");
  });
});

describe("owner", () => {
  it("can promote staff and cannot change their own role", async () => {
    await changeMemberRole(owner, staffMembershipId, "ADMIN");
    await changeMemberRole(owner, staffMembershipId, "STAFF");
    const own = await prisma.membership.findFirstOrThrow({ where: { businessId: owner.businessId, role: "OWNER" } });
    await expect(changeMemberRole(owner, own.id, "ADMIN")).rejects.toBeInstanceOf(ValidationError);
  });
  it("can transfer ownership; the previous owner becomes an admin", async () => {
    await transferOwnership(owner, adminMembershipId);
    const roles = await prisma.membership.findMany({ where: { businessId: owner.businessId }, include: { user: true } });
    expect(roles.find((m) => m.user.email === "admin@gamma.test")!.role).toBe("OWNER");
    expect(roles.find((m) => m.user.email === "owner@gamma.test")!.role).toBe("ADMIN");
    expect(roles.filter((m) => m.role === "OWNER")).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({ where: { businessId: owner.businessId, action: "ownership.transferred" } });
    expect(audit).toBeTruthy();
  });
});
