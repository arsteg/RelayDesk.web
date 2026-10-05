import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDaysYmd } from "@/lib/time";
import { createClient } from "@/server/clients";
import { changeOrderStatus } from "@/server/orders";
import { recordPayment, voidPayment } from "@/server/payments";
import { notifyClientChange, notifyOrderChange, notifyPaymentChange } from "@/server/notifications";
import { getSalesReport, periodRange, shiftPeriod } from "@/server/reports";
import { mailbox } from "./setup";
import { resetDb, seedOrder, setupBusiness, today } from "./helpers";

beforeEach(async () => {
  await resetDb();
  mailbox.sent.length = 0;
});

describe("report periods", () => {
  it("uses Monday-Sunday weeks and calendar months", () => {
    expect(periodRange("week", "2026-10-01")).toEqual({ startYmd: "2026-09-28", endYmd: "2026-10-04" });
    expect(periodRange("week", "2026-09-28")).toEqual({ startYmd: "2026-09-28", endYmd: "2026-10-04" });
    expect(periodRange("week", "2026-10-04")).toEqual({ startYmd: "2026-09-28", endYmd: "2026-10-04" });
    expect(periodRange("month", "2028-02-10")).toEqual({ startYmd: "2028-02-01", endYmd: "2028-02-29" });
    expect(shiftPeriod("month", "2026-01-15", -1)).toEqual({ startYmd: "2025-12-01", endYmd: "2025-12-31" });
    expect(shiftPeriod("day", "2026-03-01", -1)).toEqual({ startYmd: "2026-02-28", endYmd: "2026-02-28" });
  });
});

describe("sales report", () => {
  it("counts confirmed sales by order date and net collections by payment date", async () => {
    const b = await setupBusiness("Report Bakes", "owner@rep.test");
    const c = await b.ownerCtx();
    const yesterday = addDaysYmd(today(), -1);

    const { order } = await seedOrder(c); // 1000.00 today
    await seedOrder(c, { status: "DRAFT" }); // quote: not a sale
    const { order: cancelled } = await seedOrder(c);
    await changeOrderStatus(c, cancelled.id, "CANCELLED");
    const { order: older } = await seedOrder(c, { orderDate: yesterday });

    await recordPayment(c, order.id, { kind: "DEPOSIT", amount: "400", paidOn: today(), method: "UPI" });
    const { payment: mistake } = await recordPayment(c, order.id, { kind: "PAYMENT", amount: "100", paidOn: today(), method: "CASH" });
    await voidPayment(c, mistake.id, "Entered twice");
    await recordPayment(c, order.id, { kind: "REFUND", amount: "50", paidOn: today(), method: "UPI" });
    await recordPayment(c, older.id, { kind: "PAYMENT", amount: "300", paidOn: yesterday, method: "CASH" });

    const r = await getSalesReport(c, "day");
    expect(r.current.startYmd).toBe(today());
    expect(r.totals).toMatchObject({ salesMinor: 100000, orders: 1, collectedMinor: 40000, refundedMinor: 5000, newClients: 4 });
    expect(r.previousTotals).toMatchObject({ salesMinor: 100000, orders: 1, collectedMinor: 30000, refundedMinor: 0 });
    expect(r.trend).toHaveLength(14);
    expect(r.trend.at(-1)).toMatchObject({ salesMinor: 100000, collectedMinor: 35000 });
    expect(r.trend.at(-2)).toMatchObject({ salesMinor: 100000, collectedMinor: 30000 });
    expect(r.methods).toEqual([{ method: "UPI", amountMinor: 40000, count: 1 }]);
    expect(r.products).toEqual([{ name: "Cake of Report Bakes", quantityMilli: 2000, revenueMinor: 100000 }]);
    expect(Object.fromEntries(r.statuses.map((s) => [s.status, s.count]))).toEqual({ CONFIRMED: 1, DRAFT: 1, CANCELLED: 1 });

    const prev = await getSalesReport(c, "day", -1);
    expect(prev.current.startYmd).toBe(yesterday);
    expect(prev.totals.salesMinor).toBe(100000);
    // Offsets into the future are clamped to the current period.
    expect((await getSalesReport(c, "day", 3)).current.startYmd).toBe(today());

    const week = await getSalesReport(c, "month");
    expect(week.trend).toHaveLength(12);
  });

  it("never includes another business's data", async () => {
    const a = await setupBusiness("Alpha", "owner@alpha.test");
    const z = await setupBusiness("Zeta", "owner@zeta.test");
    await seedOrder(await z.ownerCtx());
    const r = await getSalesReport(await a.ownerCtx(), "month");
    expect(r.totals.salesMinor).toBe(0);
    expect(r.products).toEqual([]);
    expect(r.clients).toEqual([]);
  });
});

describe("change emails", () => {
  it("emails every verified member of the business, and nobody else", async () => {
    const b = await setupBusiness("Mail Bakes", "owner@mail.test");
    await b.addMember("admin@mail.test", "ADMIN");
    const staff = await b.addMember("staff@mail.test", "STAFF");
    await prisma.user.update({ where: { id: staff.user.id }, data: { emailVerifiedAt: null } });
    const other = await setupBusiness("Other", "owner@other.test");
    const c = await b.ownerCtx();

    const client = await createClient(c, { name: "Meera Iyer", phone: "9876500000" });
    await notifyClientChange(c, "created", client.id);
    expect(mailbox.sent.map((m) => m.to).sort()).toEqual(["admin@mail.test", "owner@mail.test"]);
    expect(mailbox.sent[0].subject).toBe("[Mail Bakes] Client added: Meera Iyer");
    expect(mailbox.sent[0].text).toContain("by owner (owner@mail.test)");
    expect(mailbox.sent[0].text).toContain(`/app/clients/${client.id}`);

    // A record from another business is never looked up or announced.
    mailbox.sent.length = 0;
    const foreign = await createClient(await other.ownerCtx(), { name: "Not yours" });
    await notifyClientChange(c, "updated", foreign.id);
    expect(mailbox.sent).toHaveLength(0);
  });

  it("describes order and payment changes", async () => {
    const b = await setupBusiness("Mail Bakes", "owner@mail.test");
    const c = await b.ownerCtx();
    const { order } = await seedOrder(c);
    await changeOrderStatus(c, order.id, "CANCELLED", "Customer called off");
    await notifyOrderChange(c, "cancelled", order.id, { reason: "Customer called off" });
    expect(mailbox.sent[0].subject).toMatch(/^\[Mail Bakes\] Order ORD-0001 cancelled \(deleted\) - Client of Mail Bakes, ₹1,000\.00$/);
    expect(mailbox.sent[0].text).toContain("Reason: Customer called off");
    expect(mailbox.sent[0].text).toContain("Cake of Mail Bakes");

    const { order: o2 } = await seedOrder(c);
    const { payment } = await recordPayment(c, o2.id, { kind: "DEPOSIT", amount: "250", paidOn: today(), method: "UPI", reference: "UPI-123" });
    await voidPayment(c, payment.id, "Wrong order");
    mailbox.sent.length = 0;
    await notifyPaymentChange(c, "voided", payment.id);
    expect(mailbox.sent[0].subject).toBe("[Mail Bakes] Deposit voided (deleted): ₹250.00 - Client of Mail Bakes (ORD-0002)");
    expect(mailbox.sent[0].text).toContain("Void reason: Wrong order");
    expect(mailbox.sent[0].text).toContain("Reference: UPI-123");
  });

  it("can be switched off with CHANGE_EMAILS_ENABLED=false", async () => {
    const b = await setupBusiness("Quiet Bakes", "owner@quiet.test");
    const c = await b.ownerCtx();
    const client = await createClient(c, { name: "Silent" });
    process.env.CHANGE_EMAILS_ENABLED = "false";
    try {
      await notifyClientChange(c, "created", client.id);
    } finally {
      delete process.env.CHANGE_EMAILS_ENABLED;
    }
    expect(mailbox.sent).toHaveLength(0);
  });
});
