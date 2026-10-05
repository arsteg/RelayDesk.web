import Link from "next/link";
import { Badge } from "@/components/ui";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { formatOrderNumber } from "@/server/orders";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS[status].tone}>{ORDER_STATUS[status].label}</Badge>;
}

export function PaymentStatusBadge({ status, orderStatus }: { status: PaymentStatus; orderStatus?: OrderStatus }) {
  if (orderStatus === "CANCELLED" && status === "PAID") return <Badge tone="gray">Settled</Badge>;
  return <Badge tone={PAYMENT_STATUS[status].tone}>{PAYMENT_STATUS[status].label}</Badge>;
}

export function OrderLink({ id, number, prefix }: { id: string; number: number; prefix: string }) {
  return (
    <Link href={`/app/orders/${id}`} className="font-medium text-brand-700 hover:underline">
      {formatOrderNumber(prefix, number)}
    </Link>
  );
}
