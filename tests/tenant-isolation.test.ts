import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { getClient, getClientDetail, listClients, setClientArchived, updateClient } from "@/server/clients";
import { getProduct, listProducts, updateProduct } from "@/server/products";
import { changeOrderStatus, createOrder, getOrder, listOrders, updateOrder } from "@/server/orders";
import { listPayments, recordPayment, voidPayment } from "@/server/payments";
import { changeMemberRole, inviteMember, listMembers, removeMember, revokeInvitation } from "@/server/members";
import { exportCsv } from "@/server/exports";
import { getDashboard } from "@/server/dashboard";
import { runDailyDigests } from "@/server/jobs";
import { fulfilment, resetDb, seedOrder, setupBusiness, today } from "./helpers";

let A: TenantContext;
let B: TenantContext;
let bData: Awaited<ReturnType<typeof seedOrder>>;
let bPaymentId: string;
let bMembershipId: string;
let bInviteId: string;
let aUserId: string;

beforeAll(async () => {
  await resetDb();
  const a = await setupBusiness("Alpha Bakes", "owner@alpha.test");
  const b = await setupBusiness("Beta Breads", "owner@beta.test");
  aUserId = a.owner.id;
  A = await a.ownerCtx();
  B = await b.ownerCtx();
  await seedOrder(A);
  bData = await seedOrder(B, { fulfillmentAt: fulfilment(0, "00:01") });
  const { payment } = await recordPayment(B, bData.order.id, { kind: "DEPOSIT", amount: "100", paidOn: today(), method: "CASH" });
  bPaymentId = payment.id;
  const staff = await b.addMember("staff@beta.test", "STAFF");
  bMembershipId = (await prisma.membership.findFirstOrThrow({ where: { userId: staff.user.id } })).id;
  bInviteId = (await inviteMember(B, { email: "new@beta.test", role: "STAFF" })).invitation.id;
});

describe("tenant isolation", () => {
  it("does not build a tenant context for a business the user does not belong to", async () => {
    expect(await loadTenantContext(aUserId, B.businessId)).toBeNull();
  });

  it("hides another business's clients from reads", async () => {
    await expect(getClient(A, bData.client.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getClientDetail(A, bData.client.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await listClients(A, { q: "Beta" });
    expect(list.rows).toHaveLength(0);
    const all = await listClients(A);
    expect(all.rows.every((c) => c.businessId === A.businessId)).toBe(true);
  });

  it("blocks mutations of another business's clients and products", async () => {
    await expect(updateClient(A, bData.client.id, { name: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setClientArchived(A, bData.client.id, true)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProduct(A, bData.product.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateProduct(A, bData.product.id, { name: "x", unit: "piece", price: "1", isAvailable: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await listProducts(A)).every((p) => p.businessId === A.businessId)).toBe(true);
    const c = await prisma.client.findUniqueOrThrow({ where: { id: bData.client.id } });
    expect(c.name).not.toBe("Hijacked");
    expect(c.archivedAt).toBeNull();
  });

  it("blocks reading and changing another business's orders", async () => {
    await expect(getOrder(A, bData.order.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(changeOrderStatus(A, bData.order.id, "CANCELLED")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateOrder(A, bData.order.id, {
        clientId: bData.client.id,
        orderDate: today(),
        fulfillmentAt: fulfilment(),
        fulfillmentType: "PICKUP",
        items: [{ description: "x", quantity: "1", unitPrice: "1" }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const list = await listOrders(A);
    expect(list.rows.every((o) => o.businessId === A.businessId)).toBe(true);
  });

  it("rejects orders that reference another business's client or product", async () => {
    const base = { orderDate: today(), fulfillmentAt: fulfilment(), fulfillmentType: "PICKUP" as const };
    await expect(
      createOrder(A, { ...base, clientId: bData.client.id, items: [{ description: "x", quantity: "1", unitPrice: "1" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const ownClient = (await listClients(A)).rows[0];
    await expect(
      createOrder(A, {
        ...base,
        clientId: ownClient.id,
        items: [{ productId: bData.product.id, description: "x", quantity: "1", unitPrice: "1" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces tenant integrity in the database itself (composite foreign keys)", async () => {
    const ownClient = (await listClients(A)).rows[0];
    // An order row in business A pointing at business B's client is rejected by Postgres.
    await expect(
      prisma.order.create({
        data: {
          businessId: A.businessId,
          number: 9999,
          clientId: bData.client.id,
          orderDate: new Date(),
          fulfillmentAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    // A payment in business A against business B's order is rejected too.
    await expect(
      prisma.payment.create({
        data: { businessId: A.businessId, orderId: bData.order.id, kind: "PAYMENT", amountMinor: 1, paidOn: new Date(), method: "CASH" },
      }),
    ).rejects.toThrow();
    expect(ownClient.businessId).toBe(A.businessId);
  });

  it("blocks payments against another business's orders and voids of its payments", async () => {
    await expect(
      recordPayment(A, bData.order.id, { kind: "PAYMENT", amount: "1", paidOn: today(), method: "CASH" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(voidPayment(A, bPaymentId, "mistake")).rejects.toBeInstanceOf(NotFoundError);
    const list = await listPayments(A);
    expect(list.rows.every((p) => p.businessId === A.businessId)).toBe(true);
    expect(list.rows.find((p) => p.id === bPaymentId)).toBeUndefined();
  });

  it("blocks managing another business's members and invitations", async () => {
    await expect(changeMemberRole(A, bMembershipId, "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeMember(A, bMembershipId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeInvitation(A, bInviteId)).rejects.toBeInstanceOf(NotFoundError);
    const { members, invitations } = await listMembers(A);
    expect(members.every((m) => m.businessId === A.businessId)).toBe(true);
    expect(invitations).toHaveLength(0);
  });

  it("scopes CSV exports to the current business", async () => {
    for (const kind of ["clients", "orders", "payments"] as const) {
      const csv = await exportCsv(A, kind);
      expect(csv).not.toContain("Beta");
    }
    expect(await exportCsv(A, "clients")).toContain("Client of Alpha Bakes");
  });

  it("scopes dashboard figures to the current business", async () => {
    const dA = await getDashboard(A);
    const ids = [...dA.todayOrders, ...dA.upcoming, ...dA.overdue].map((o) => o.id);
    expect(ids).not.toContain(bData.order.id);
    expect(dA.collectedTodayMinor).toBe(0);
    const dB = await getDashboard(B);
    expect(dB.collectedTodayMinor).toBe(10000);
  });

  it("scopes background job output per business", async () => {
    const results = await runDailyDigests(new Date(), { send: false });
    const a = results.find((r) => r.businessId === A.businessId)!;
    const b = results.find((r) => r.businessId === B.businessId)!;
    expect(a.recipients).toEqual(["owner@alpha.test"]);
    expect(b.recipients).toEqual(["owner@beta.test"]);
    expect([...a.todayOrderIds, ...a.overdueOrderIds]).not.toContain(bData.order.id);
    expect(b.outstandingMinor).toBe(100000 - 10000);
  });

  it("allocates order numbers independently per business", async () => {
    const aOrders = await prisma.order.findMany({ where: { businessId: A.businessId }, orderBy: { number: "asc" } });
    const bOrders = await prisma.order.findMany({ where: { businessId: B.businessId }, orderBy: { number: "asc" } });
    expect(aOrders[0].number).toBe(1);
    expect(bOrders[0].number).toBe(1);
  });
});
