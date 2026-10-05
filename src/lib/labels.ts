import type { BadgeTone } from "@/components/ui";
import type { OrderStatus, PaymentKind, PaymentMethod, PaymentStatus, SubscriptionStatus } from "@/generated/prisma/enums";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  CONFIRMED: { label: "Confirmed", tone: "blue" },
  IN_PROGRESS: { label: "In progress", tone: "violet" },
  READY: { label: "Ready", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

/** Button labels for moving an order to a status. */
export const STATUS_ACTION: Record<OrderStatus, string> = {
  DRAFT: "Back to draft",
  CONFIRMED: "Confirm order",
  IN_PROGRESS: "Start baking",
  READY: "Mark ready",
  COMPLETED: "Mark completed",
  CANCELLED: "Cancel order",
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  UNPAID: { label: "Unpaid", tone: "red" },
  PARTIAL: { label: "Partially paid", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
  OVERPAID: { label: "Refund due", tone: "violet" },
};

export const PAYMENT_KIND: Record<PaymentKind, string> = { DEPOSIT: "Deposit", PAYMENT: "Payment", REFUND: "Refund" };

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
  RAZORPAY: "Online (Razorpay)",
  OTHER: "Other",
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: BadgeTone }> = {
  TRIALING: { label: "Trial", tone: "blue" },
  ACTIVE: { label: "Active", tone: "green" },
  PAST_DUE: { label: "Past due", tone: "amber" },
  CANCELED: { label: "Cancelled", tone: "red" },
};
