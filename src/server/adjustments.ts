import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseQuantityToMilli } from "@/lib/money";
import { actorOf, assertCan, assertWritable, type TenantContext } from "@/server/context";
import { recomputeOrderTotals } from "@/server/recompute";

/** Delivery/receipt adjustments can be recorded until the order is cancelled. */
function assertAdjustable(status: string) {
  if (status === "CANCELLED") throw new ValidationError("A cancelled order cannot be adjusted.");
}

function requireReason(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new ValidationError("Give a reason (at least 3 characters).", { reason: "Required" });
  return r.slice(0, 500);
}

/**
 * Shortfall: the customer received less than invoiced. Reduce the line to the
 * received quantity (downward only — a higher measured quantity is ignored),
 * re-price the invoice, and record a traceable adjustment. Returns changed=false
 * when the received amount is not lower than what was invoiced.
 */
export async function recordShortfall(ctx: TenantContext, orderItemId: string, receivedQty: string, reason: string) {
  assertCan(ctx, "orders.adjust");
  assertWritable(ctx);
  const receivedMilli = parseQuantityToMilli(receivedQty);
  if (receivedMilli === null || receivedMilli < 0) throw new ValidationError("Please fix the highlighted fields.", { received: "Enter a valid quantity" });
  const why = requireReason(reason);

  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: { id: orderItemId, businessId: ctx.businessId },
      select: { id: true, orderId: true, description: true, quantityMilli: true, order: { select: { status: true } } },
    });
    if (!item) throw new NotFoundError("Order line");
    assertAdjustable(item.order.status);
    if (receivedMilli >= item.quantityMilli) {
      return { changed: false as const, reason: "Received quantity is not lower than invoiced — no adjustment needed." };
    }

    await tx.orderItem.update({ where: { id: item.id }, data: { quantityMilli: receivedMilli, capturedQtyMilli: receivedMilli } });
    await tx.orderAdjustment.create({
      data: { businessId: ctx.businessId, orderId: item.orderId, orderItemId: item.id, type: "SHORTFALL", fromQtyMilli: item.quantityMilli, toQtyMilli: receivedMilli, reason: why, actorUserId: ctx.userId },
    });
    const totals = await recomputeOrderTotals(tx, ctx.businessId, item.orderId);
    await audit(tx, { businessId: ctx.businessId, actor: actorOf(ctx), action: "order.adjusted", entityType: "OrderItem", entityId: item.id, metadata: { type: "SHORTFALL", from: item.quantityMilli, to: receivedMilli, reason: why } });
    return { changed: true as const, totals };
  });
}

/**
 * Not delivered: remove the line from the invoice entirely, re-price, and
 * record a traceable adjustment (the removed line's details are kept in the
 * adjustment + audit metadata).
 */
export async function recordNotDelivered(ctx: TenantContext, orderItemId: string, reason: string) {
  assertCan(ctx, "orders.adjust");
  assertWritable(ctx);
  const why = requireReason(reason);

  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: { id: orderItemId, businessId: ctx.businessId },
      select: { id: true, orderId: true, description: true, quantityMilli: true, unitPriceMinor: true, order: { select: { status: true } } },
    });
    if (!item) throw new NotFoundError("Order line");
    assertAdjustable(item.order.status);

    await tx.orderAdjustment.create({
      data: { businessId: ctx.businessId, orderId: item.orderId, orderItemId: item.id, type: "NOT_DELIVERED", fromQtyMilli: item.quantityMilli, toQtyMilli: 0, reason: why, actorUserId: ctx.userId },
    });
    await tx.orderItem.delete({ where: { id: item.id } });
    const totals = await recomputeOrderTotals(tx, ctx.businessId, item.orderId);
    await audit(tx, { businessId: ctx.businessId, actor: actorOf(ctx), action: "order.adjusted", entityType: "OrderItem", entityId: item.id, metadata: { type: "NOT_DELIVERED", description: item.description, qtyMilli: item.quantityMilli, reason: why } });
    return { totals };
  });
}

/** Adjustment history for an order (most recent first). */
export async function listAdjustments(ctx: TenantContext, orderId: string) {
  assertCan(ctx, "orders.adjust");
  return prisma.orderAdjustment.findMany({ where: { businessId: ctx.businessId, orderId }, orderBy: { createdAt: "desc" } });
}
