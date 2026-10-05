import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney, parseMoneyToMinor } from "@/lib/money";
import { MAX_MINOR } from "@/lib/limits";
import { amountDue, derivePaymentStatus, netPaid } from "@/lib/totals";
import { dateOnly, dayBoundsUtc, zonedDateString } from "@/lib/time";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentKind, PaymentMethod } from "@/generated/prisma/enums";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { lockOrder } from "@/server/orders";
import { optionalText, parseOrThrow } from "@/server/validation";

export const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"];
export const PAYMENT_KINDS: PaymentKind[] = ["DEPOSIT", "PAYMENT", "REFUND"];

export const paymentSchema = z.object({
  kind: z.enum(["DEPOSIT", "PAYMENT", "REFUND"]),
  amount: z.string().trim().min(1, "Amount is required"),
  paidOn: z.string().min(1, "Date is required"),
  method: z.enum(["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"]),
  reference: optionalText(120),
  notes: optionalText(1000),
});
export type PaymentInput = z.input<typeof paymentSchema>;

/** Recalculate paid amount and payment status from the payment rows (source of truth). */
export async function syncOrderPayments(tx: Db, businessId: string, orderId: string) {
  const order = await tx.order.findFirstOrThrow({ where: { id: orderId, businessId } });
  const payments = await tx.payment.findMany({ where: { orderId, businessId } });
  const paidMinor = netPaid(payments);
  return tx.order.update({
    where: { id: order.id },
    data: { paidMinor, paymentStatus: derivePaymentStatus(order.totalMinor, paidMinor, order.status) },
  });
}

/**
 * Rules
 * - DEPOSIT / PAYMENT: positive, may not exceed the outstanding balance
 *   (no overpayments), not allowed on cancelled orders.
 * - REFUND: positive, may not exceed the net amount paid so far.
 */
export async function recordPayment(ctx: TenantContext, orderId: string, input: PaymentInput) {
  assertCan(ctx, "payments.record");
  assertWritable(ctx);
  const data = parseOrThrow(paymentSchema, input);
  if (data.kind === "REFUND") assertCan(ctx, "payments.refund");
  const currency = ctx.business.currency;
  const amountMinor = parseMoneyToMinor(data.amount, currency);
  if (!amountMinor || amountMinor <= 0 || amountMinor > MAX_MINOR) {
    throw new ValidationError("Please fix the highlighted fields.", { amount: "Enter an amount greater than zero" });
  }
  const paidOn = dateOnly(data.paidOn);
  if (!paidOn) throw new ValidationError("Please fix the highlighted fields.", { paidOn: "Enter a valid date" });
  const today = zonedDateString(new Date(), ctx.business.timezone);
  if (data.paidOn > today) {
    throw new ValidationError("Please fix the highlighted fields.", { paidOn: "Payment date cannot be in the future" });
  }

  return prisma.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx, orderId);
    const due = amountDue(order.totalMinor, order.status);
    const balance = due - order.paidMinor;

    if (data.kind === "REFUND") {
      if (amountMinor > order.paidMinor) {
        throw new ValidationError(
          `Refund exceeds the amount paid (${formatMoney(order.paidMinor, currency)}).`,
          { amount: `Maximum refund is ${formatMoney(Math.max(order.paidMinor, 0), currency)}` },
        );
      }
    } else {
      if (order.status === "CANCELLED") {
        throw new ValidationError("Payments cannot be recorded against a cancelled order.");
      }
      if (amountMinor > balance) {
        throw new ValidationError(
          balance <= 0
            ? "This order is already fully paid."
            : `Amount exceeds the outstanding balance of ${formatMoney(balance, currency)}.`,
          { amount: balance <= 0 ? "Nothing is outstanding" : `Maximum is ${formatMoney(balance, currency)}` },
        );
      }
    }

    const payment = await tx.payment.create({
      data: {
        businessId: ctx.businessId,
        orderId: order.id,
        kind: data.kind,
        amountMinor,
        paidOn,
        method: data.method,
        reference: data.reference,
        notes: data.notes,
        recordedById: ctx.userId,
      },
    });
    const updated = await syncOrderPayments(tx, ctx.businessId, order.id);
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: data.kind === "REFUND" ? "payment.refunded" : "payment.recorded",
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        orderId: order.id,
        orderNumber: order.number,
        kind: data.kind,
        amountMinor,
        method: data.method,
        paidMinorAfter: updated.paidMinor,
      },
    });
    return { payment, order: updated };
  });
}

/**
 * Corrections: a payment is voided (with a reason) rather than edited or
 * deleted. The voided row stays visible in history and the audit log.
 */
export async function voidPayment(ctx: TenantContext, paymentId: string, reasonInput: string) {
  assertCan(ctx, "payments.void");
  assertWritable(ctx);
  const reason = reasonInput?.trim();
  if (!reason || reason.length < 3) throw new ValidationError("Give a reason for voiding this payment.", { reason: "Reason is required" });

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { id: paymentId, businessId: ctx.businessId } });
    if (!payment) throw new NotFoundError("Payment");
    const order = await lockOrder(tx, ctx, payment.orderId);
    if (payment.voidedAt) throw new ValidationError("This payment has already been voided.");

    const payments = await tx.payment.findMany({ where: { orderId: order.id, businessId: ctx.businessId } });
    const after = netPaid(payments.map((p) => (p.id === payment.id ? { ...p, voidedAt: new Date() } : p)));
    if (after < 0) {
      throw new ValidationError("Voiding this payment would leave more refunded than paid. Void the related refund first.");
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedById: ctx.userId, voidReason: reason.slice(0, 500) },
    });
    const updated = await syncOrderPayments(tx, ctx.businessId, order.id);
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "payment.voided",
      entityType: "Payment",
      entityId: payment.id,
      metadata: {
        orderId: order.id,
        orderNumber: order.number,
        kind: payment.kind,
        amountMinor: payment.amountMinor,
        reason,
        paidMinorAfter: updated.paidMinor,
      },
    });
    return updated;
  });
}

export interface PaymentFilters {
  from?: string;
  to?: string;
  method?: PaymentMethod;
  kind?: PaymentKind;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listPayments(ctx: TenantContext, f: PaymentFilters = {}) {
  assertNotSuspended(ctx);
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const where: Prisma.PaymentWhereInput = {
    businessId: ctx.businessId,
    ...(f.includeVoided ? {} : { voidedAt: null }),
    ...(f.method && PAYMENT_METHODS.includes(f.method) ? { method: f.method } : {}),
    ...(f.kind && PAYMENT_KINDS.includes(f.kind) ? { kind: f.kind } : {}),
    ...(f.from || f.to
      ? {
          paidOn: {
            ...(f.from && dateOnly(f.from) ? { gte: dateOnly(f.from)! } : {}),
            ...(f.to && dateOnly(f.to) ? { lte: dateOnly(f.to)! } : {}),
          },
        }
      : {}),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { order: { select: { id: true, number: true, client: { select: { id: true, name: true } } } } },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ["kind"], where: { ...where, voidedAt: null }, _sum: { amountMinor: true } }),
  ]);
  const sumOf = (k: PaymentKind) => sums.find((s) => s.kind === k)?._sum.amountMinor ?? 0;
  const received = sumOf("DEPOSIT") + sumOf("PAYMENT");
  const refunded = sumOf("REFUND");
  return { rows, total, page, pageSize, totals: { received, refunded, net: received - refunded } };
}

/**
 * End-of-day reconciliation for a date (business-local calendar day): what was
 * expected (sum of the day's order totals) versus what was collected (net of
 * payments recorded on that day), broken down by method, with how many of the
 * day's payments are still unreconciled.
 */
export async function getReconciliation(ctx: TenantContext, ymd: string) {
  assertCan(ctx, "payments.record");
  assertNotSuspended(ctx);
  const day = dateOnly(ymd);
  if (!day) throw new ValidationError("Enter a valid date.", { date: "Invalid date" });
  const { start, end } = dayBoundsUtc(ymd, ctx.business.timezone);

  const [orders, payments] = await Promise.all([
    prisma.order.findMany({ where: { businessId: ctx.businessId, fulfillmentAt: { gte: start, lt: end }, status: { not: "CANCELLED" } }, select: { totalMinor: true } }),
    prisma.payment.findMany({ where: { businessId: ctx.businessId, paidOn: day, voidedAt: null }, select: { kind: true, method: true, amountMinor: true, reconciledAt: true } }),
  ]);

  const expectedMinor = orders.reduce((a, o) => a + o.totalMinor, 0);
  const signed = (p: { kind: PaymentKind; amountMinor: number }) => (p.kind === "REFUND" ? -p.amountMinor : p.amountMinor);
  const collectedMinor = payments.reduce((a, p) => a + signed(p), 0);
  const byMethod = PAYMENT_METHODS.map((m) => ({ method: m, amountMinor: payments.filter((p) => p.method === m).reduce((a, p) => a + signed(p), 0) })).filter((r) => r.amountMinor !== 0);
  const unreconciled = payments.filter((p) => !p.reconciledAt).length;

  return { date: ymd, expectedMinor, collectedMinor, differenceMinor: expectedMinor - collectedMinor, byMethod, paymentCount: payments.length, unreconciled };
}

/** Mark all of a day's non-voided, not-yet-reconciled payments as reconciled. */
export async function reconcileDay(ctx: TenantContext, ymd: string) {
  assertCan(ctx, "payments.record");
  assertWritable(ctx);
  const day = dateOnly(ymd);
  if (!day) throw new ValidationError("Enter a valid date.", { date: "Invalid date" });
  return prisma.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({
      where: { businessId: ctx.businessId, paidOn: day, voidedAt: null, reconciledAt: null },
      data: { reconciledAt: new Date(), reconciledById: ctx.userId },
    });
    await audit(tx, { businessId: ctx.businessId, actor: actorOf(ctx), action: "payments.reconciled", entityType: "Payment", entityId: ymd, metadata: { date: ymd, count: res.count } });
    return { count: res.count };
  });
}
