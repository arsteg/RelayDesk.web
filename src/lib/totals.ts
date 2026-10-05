import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";

export interface LineInput {
  quantityMilli: number;
  unitPriceMinor: number;
}

/** Integer rounding, half away from zero. */
function roundHalfUp(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function lineTotal(line: LineInput): number {
  // quantityMilli/1000 * price, done in integers to keep exactness where possible
  return roundHalfUp((line.quantityMilli * line.unitPriceMinor) / 1000);
}

export interface TotalsInput {
  lines: LineInput[];
  discountMinor: number;
  taxBps: number;
  deliveryChargeMinor: number;
}

export interface Totals {
  lineTotals: number[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  deliveryChargeMinor: number;
  totalMinor: number;
}

/**
 * Order totals:
 *   subtotal = sum(line totals)
 *   tax      = round((subtotal - discount) * taxBps / 10000)
 *   total    = subtotal - discount + tax + delivery
 * Tax is applied after discount and is not charged on the delivery fee.
 */
export function computeTotals(input: TotalsInput): Totals {
  const lineTotals = input.lines.map(lineTotal);
  const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0);
  if (input.discountMinor < 0) throw new RangeError("Discount cannot be negative");
  if (input.discountMinor > subtotalMinor) throw new RangeError("Discount cannot exceed the subtotal");
  if (input.taxBps < 0 || input.taxBps > 10000) throw new RangeError("Tax rate must be between 0% and 100%");
  if (input.deliveryChargeMinor < 0) throw new RangeError("Delivery charge cannot be negative");
  const taxable = subtotalMinor - input.discountMinor;
  const taxMinor = roundHalfUp((taxable * input.taxBps) / 10000);
  const totalMinor = taxable + taxMinor + input.deliveryChargeMinor;
  return {
    lineTotals,
    subtotalMinor,
    discountMinor: input.discountMinor,
    taxMinor,
    deliveryChargeMinor: input.deliveryChargeMinor,
    totalMinor,
  };
}

/** Amount the customer currently owes before payments. A cancelled order owes nothing. */
export function amountDue(totalMinor: number, status: OrderStatus): number {
  return status === "CANCELLED" ? 0 : totalMinor;
}

export function derivePaymentStatus(totalMinor: number, paidMinor: number, status: OrderStatus): PaymentStatus {
  const due = amountDue(totalMinor, status);
  if (paidMinor > due) return "OVERPAID";
  if (paidMinor <= 0) return due === 0 ? "PAID" : "UNPAID";
  if (paidMinor < due) return "PARTIAL";
  return "PAID";
}

export function balanceMinor(totalMinor: number, paidMinor: number, status: OrderStatus): number {
  return amountDue(totalMinor, status) - paidMinor;
}

export interface PaymentLike {
  kind: "DEPOSIT" | "PAYMENT" | "REFUND";
  amountMinor: number;
  voidedAt: Date | null;
}

/** Net amount received: deposits + payments - refunds, ignoring voided rows. */
export function netPaid(payments: PaymentLike[]): number {
  return payments
    .filter((p) => !p.voidedAt)
    .reduce((sum, p) => sum + (p.kind === "REFUND" ? -p.amountMinor : p.amountMinor), 0);
}
