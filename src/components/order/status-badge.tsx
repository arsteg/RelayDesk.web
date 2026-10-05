import { Badge, type BadgeTone } from "@/components/ui";
import { ORDER_STATUS_LABELS, type OrderStatus, type PaymentStatus } from "@relaydesk/shared";

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  DRAFT: "gray",
  CONFIRMED: "blue",
  IN_PROGRESS: "amber",
  READY: "violet",
  COMPLETED: "green",
  CANCELLED: "red",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  UNPAID: "red",
  PARTIAL: "amber",
  PAID: "green",
  OVERPAID: "violet",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
