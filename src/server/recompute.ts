import { type Db } from "@/lib/db";
import { computeTotals, derivePaymentStatus, lineTotal } from "@/lib/totals";

/**
 * Recompute an order's line totals and money totals from its current item
 * quantities/prices, re-deriving the payment status against the existing
 * `paidMinor`. Used after a quantity is captured during preparation or changed
 * by a delivery adjustment. The order's discount is clamped to the (possibly
 * reduced) subtotal so totals never go negative.
 */
export async function recomputeOrderTotals(tx: Db, businessId: string, orderId: string) {
  const order = await tx.order.findFirstOrThrow({
    where: { id: orderId, businessId },
    select: { id: true, discountMinor: true, taxBps: true, deliveryChargeMinor: true, paidMinor: true, status: true },
  });
  const items = await tx.orderItem.findMany({
    where: { businessId, orderId },
    select: { id: true, quantityMilli: true, unitPriceMinor: true },
  });
  const lines = items.map((i) => ({ quantityMilli: i.quantityMilli, unitPriceMinor: i.unitPriceMinor }));
  const subtotal = lines.map(lineTotal).reduce((a, b) => a + b, 0);
  const discountMinor = Math.min(order.discountMinor, subtotal);
  const totals = computeTotals({ lines, discountMinor, taxBps: order.taxBps, deliveryChargeMinor: order.deliveryChargeMinor });

  for (let i = 0; i < items.length; i++) {
    if (items[i] !== undefined) await tx.orderItem.update({ where: { id: items[i].id }, data: { lineTotalMinor: totals.lineTotals[i] } });
  }
  await tx.order.update({
    where: { id: order.id },
    data: {
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paymentStatus: derivePaymentStatus(totals.totalMinor, order.paidMinor, order.status),
    },
  });
  return totals;
}
