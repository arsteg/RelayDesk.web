import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseQuantityToMilli, formatQuantity } from "@/lib/money";
import { dayBoundsUtc } from "@/lib/time";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { recomputeOrderTotals } from "@/server/recompute";
import { parseOrThrow } from "@/server/validation";

const captureSchema = z.object({
  captures: z
    .array(z.object({ gross: z.string().trim().min(1, "Gross is required"), tare: z.string().trim().optional().nullable() }))
    .min(1, "Record at least one crate/measure"),
});
export type CaptureInput = z.input<typeof captureSchema>;

/** Statuses during which a line may still be weighed/measured. */
const CAPTURABLE = new Set(["CONFIRMED", "IN_PROGRESS", "READY"]);

/**
 * Record the actual measure for a variable-measure order line from one or more
 * gross/tare captures (e.g. crates). Sets the billed quantity to the net
 * (Σgross − Σtare), re-prices the order, and moves a CONFIRMED order to
 * IN_PROGRESS. Idempotent: existing captures for the line are replaced.
 */
export async function captureLine(ctx: TenantContext, orderItemId: string, input: CaptureInput) {
  assertCan(ctx, "prep.record");
  assertWritable(ctx);
  const data = parseOrThrow(captureSchema, input);

  let grossSum = 0;
  let tareSum = 0;
  const rows: { grossMilli: number; tareMilli: number }[] = [];
  for (const c of data.captures) {
    const grossMilli = parseQuantityToMilli(c.gross);
    const tareMilli = c.tare && c.tare.trim() ? parseQuantityToMilli(c.tare) : 0;
    if (grossMilli === null || grossMilli <= 0) throw new ValidationError("Please fix the highlighted fields.", { gross: "Enter a valid gross measure" });
    if (tareMilli === null || tareMilli < 0) throw new ValidationError("Please fix the highlighted fields.", { tare: "Enter a valid tare" });
    if (tareMilli > grossMilli) throw new ValidationError("Please fix the highlighted fields.", { tare: "Tare cannot exceed gross" });
    grossSum += grossMilli;
    tareSum += tareMilli;
    rows.push({ grossMilli, tareMilli });
  }
  const netMilli = grossSum - tareSum;
  if (netMilli <= 0) throw new ValidationError("Net measure must be greater than zero.", { gross: "Net is zero or negative" });

  return prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findFirst({
      where: { id: orderItemId, businessId: ctx.businessId },
      select: { id: true, orderId: true, description: true, order: { select: { id: true, status: true } } },
    });
    if (!item) throw new NotFoundError("Order line");
    if (!CAPTURABLE.has(item.order.status)) throw new ValidationError("This order can no longer be weighed.");

    await tx.orderItemCapture.deleteMany({ where: { orderItemId: item.id } });
    await tx.orderItemCapture.createMany({ data: rows.map((r) => ({ orderItemId: item.id, grossMilli: r.grossMilli, tareMilli: r.tareMilli })) });
    await tx.orderItem.update({ where: { id: item.id }, data: { capturedQtyMilli: netMilli, quantityMilli: netMilli } });

    if (item.order.status === "CONFIRMED") {
      await tx.order.update({ where: { id: item.order.id }, data: { status: "IN_PROGRESS" } });
      await tx.orderStatusHistory.create({ data: { businessId: ctx.businessId, orderId: item.order.id, fromStatus: "CONFIRMED", toStatus: "IN_PROGRESS", source: "admin", changedByUserId: ctx.userId } });
    }

    const totals = await recomputeOrderTotals(tx, ctx.businessId, item.orderId);
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "prep.captured",
      entityType: "OrderItem",
      entityId: item.id,
      metadata: { grossMilli: grossSum, tareMilli: tareSum, netMilli, crates: rows.length },
    });
    return { orderItemId: item.id, netMilli, totals };
  });
}

/**
 * Aggregated preparation sheet for a fulfilment date: how much of each product
 * must be prepared, totalled by order unit, with an estimated measure where the
 * order unit differs from the pricing unit. Excludes draft/cancelled/completed.
 */
export async function getPreparationSheet(ctx: TenantContext, ymd: string) {
  assertCan(ctx, "prep.record");
  assertNotSuspended(ctx);
  const { start, end } = dayBoundsUtc(ymd, ctx.business.timezone);
  const orders = await prisma.order.findMany({
    where: { businessId: ctx.businessId, fulfillmentAt: { gte: start, lt: end }, status: { in: ["CONFIRMED", "IN_PROGRESS", "READY"] } },
    select: { id: true, items: { select: { productId: true, description: true, unit: true, orderUnit: true, orderedQtyMilli: true, quantityMilli: true, product: { select: { unit: true, estConversionPerOrderUnit: true } } } } },
  });

  type Row = { key: string; name: string; orderUnit: string; totalOrderedMilli: number; estMeasureMilli: number | null; measureUnit: string | null };
  const rows = new Map<string, Row>();
  for (const o of orders) {
    for (const it of o.items) {
      const orderUnit = it.orderUnit ?? it.unit ?? "";
      const key = `${it.productId ?? it.description}__${orderUnit}`;
      const ordered = it.orderedQtyMilli ?? it.quantityMilli;
      const pricingUnit = it.product?.unit ?? it.unit ?? null;
      const conv = it.product?.estConversionPerOrderUnit ?? null;
      const estPerThisLine = conv && pricingUnit && pricingUnit !== orderUnit ? Math.round((ordered * conv) / 1000) : null;
      const existing = rows.get(key);
      if (existing) {
        existing.totalOrderedMilli += ordered;
        if (estPerThisLine !== null) existing.estMeasureMilli = (existing.estMeasureMilli ?? 0) + estPerThisLine;
      } else {
        rows.set(key, {
          key,
          name: it.description,
          orderUnit,
          totalOrderedMilli: ordered,
          estMeasureMilli: estPerThisLine,
          measureUnit: estPerThisLine !== null ? pricingUnit : null,
        });
      }
    }
  }
  return {
    date: ymd,
    orderCount: orders.length,
    rows: Array.from(rows.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        name: r.name,
        orderUnit: r.orderUnit,
        orderedQty: formatQuantity(r.totalOrderedMilli),
        estMeasure: r.estMeasureMilli !== null ? `${formatQuantity(r.estMeasureMilli)} ${r.measureUnit ?? ""}`.trim() : null,
      })),
  };
}
