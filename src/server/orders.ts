import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor, parsePercentToBps, parseQuantityToMilli } from "@/lib/money";
import { computeTotals, derivePaymentStatus } from "@/lib/totals";
import { dateOnly, dayBoundsUtc, monthBoundsUtc, zonedLocalToUtc } from "@/lib/time";
import { billingEnabled } from "@/lib/features";
import { getPlan } from "@/lib/plans";
import { MAX_ITEMS_PER_ORDER, MAX_MINOR, MAX_QUANTITY_MILLI } from "@/lib/limits";
import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { optionalText, parseOrThrow } from "@/server/validation";

export const ORDER_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"];
export const PAYMENT_STATUSES: PaymentStatus[] = ["UNPAID", "PARTIAL", "PAID", "OVERPAID"];

/** Allowed status transitions. COMPLETED and CANCELLED are final. */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["READY", "COMPLETED", "CANCELLED"],
  READY: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const EDITABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PROGRESS", "READY"];
export const OPEN_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PROGRESS", "READY"];
/** Committed work that can be late. Draft quotes are never "overdue". */
export const ACTIVE_STATUSES: OrderStatus[] = ["CONFIRMED", "IN_PROGRESS", "READY"];

export function formatOrderNumber(prefix: string, number: number) {
  return `${prefix}${String(number).padStart(4, "0")}`;
}

const itemSchema = z.object({
  productId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null),
  description: z.string().trim().min(1, "Item description is required").max(300),
  unit: optionalText(30),
  quantity: z.string().trim().min(1, "Quantity is required"),
  unitPrice: z.string().trim().min(1, "Price is required"),
});

export const orderSchema = z
  .object({
    clientId: z.string().min(1, "Choose a client"),
    orderDate: z.string().min(1, "Order date is required"),
    fulfillmentAt: z.string().min(1, "Fulfilment date and time are required"),
    fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
    deliveryAddress: optionalText(500),
    notes: optionalText(2000),
    discount: z.string().optional().default(""),
    taxRate: z.string().optional().default(""),
    deliveryCharge: z.string().optional().default(""),
    status: z.enum(["DRAFT", "CONFIRMED"]).optional(),
    /** updatedAt the editor loaded; a mismatch means someone else saved first. */
    expectedUpdatedAt: z.string().optional(),
    items: z.array(itemSchema).min(1, "Add at least one item").max(MAX_ITEMS_PER_ORDER, `An order can have at most ${MAX_ITEMS_PER_ORDER} items`),
  })
  .refine((o) => o.fulfillmentType !== "DELIVERY" || !!o.deliveryAddress, {
    message: "Delivery address is required for deliveries",
    path: ["deliveryAddress"],
  });
export type OrderInput = z.input<typeof orderSchema>;

interface NormalisedOrder {
  clientId: string;
  orderDate: Date;
  fulfillmentAt: Date;
  fulfillmentType: "PICKUP" | "DELIVERY";
  deliveryAddress: string | null;
  notes: string | null;
  discountMinor: number;
  taxBps: number;
  deliveryChargeMinor: number;
  status?: "DRAFT" | "CONFIRMED";
  items: {
    productId: string | null;
    description: string;
    unit: string | null;
    quantityMilli: number;
    unitPriceMinor: number;
  }[];
}

/** Validate and convert form strings into integer money/quantity values. */
export function normaliseOrderInput(ctx: TenantContext, input: OrderInput): NormalisedOrder {
  const data = parseOrThrow(orderSchema, input);
  const errors: Record<string, string> = {};
  const currency = ctx.business.currency;

  const orderDate = dateOnly(data.orderDate);
  if (!orderDate) errors.orderDate = "Enter a valid date";
  const fulfillmentAt = zonedLocalToUtc(data.fulfillmentAt, ctx.business.timezone);
  if (!fulfillmentAt) errors.fulfillmentAt = "Enter a valid date and time";

  const discountMinor = data.discount.trim() === "" ? 0 : parseMoneyToMinor(data.discount, currency);
  if (discountMinor === null || discountMinor > MAX_MINOR) errors.discount = "Enter a valid amount";
  const deliveryChargeMinor = data.deliveryCharge.trim() === "" ? 0 : parseMoneyToMinor(data.deliveryCharge, currency);
  if (deliveryChargeMinor === null || deliveryChargeMinor > MAX_MINOR) errors.deliveryCharge = "Enter a valid amount";
  const taxBps = data.taxRate.trim() === "" ? 0 : parsePercentToBps(data.taxRate);
  if (taxBps === null) errors.taxRate = "Enter a percentage between 0 and 100";

  const items = data.items.map((item, i) => {
    const quantityMilli = parseQuantityToMilli(item.quantity);
    if (!quantityMilli) errors[`items.${i}.quantity`] = "Enter a quantity greater than 0";
    else if (quantityMilli > MAX_QUANTITY_MILLI) errors[`items.${i}.quantity`] = "Quantity is too large";
    const unitPriceMinor = parseMoneyToMinor(item.unitPrice, currency);
    if (unitPriceMinor === null) errors[`items.${i}.unitPrice`] = "Enter a valid price";
    else if (unitPriceMinor > MAX_MINOR) errors[`items.${i}.unitPrice`] = "Price is too large";
    return {
      productId: item.productId,
      description: item.description,
      unit: item.unit,
      quantityMilli: quantityMilli ?? 0,
      unitPriceMinor: unitPriceMinor ?? 0,
    };
  });

  if (Object.keys(errors).length) throw new ValidationError("Please fix the highlighted fields.", errors);

  return {
    clientId: data.clientId,
    orderDate: orderDate!,
    fulfillmentAt: fulfillmentAt!,
    fulfillmentType: data.fulfillmentType,
    deliveryAddress: data.fulfillmentType === "DELIVERY" ? data.deliveryAddress : null,
    notes: data.notes,
    discountMinor: discountMinor!,
    taxBps: taxBps!,
    deliveryChargeMinor: deliveryChargeMinor!,
    status: data.status,
    items,
  };
}

function totalsFor(order: NormalisedOrder) {
  let totals;
  try {
    totals = computeTotals({
      lines: order.items,
      discountMinor: order.discountMinor,
      taxBps: order.taxBps,
      deliveryChargeMinor: order.deliveryChargeMinor,
    });
  } catch (err) {
    if (err instanceof RangeError) {
      const field = err.message.includes("Discount") ? "discount" : err.message.includes("Tax") ? "taxRate" : "deliveryCharge";
      throw new ValidationError(err.message, { [field]: err.message });
    }
    throw err;
  }
  // Every stored amount must fit the INTEGER columns.
  if (totals.subtotalMinor > MAX_MINOR || totals.totalMinor > MAX_MINOR || totals.lineTotals.some((l) => l > MAX_MINOR)) {
    throw new ValidationError("This order's total is larger than RelayDesk supports. Split it into several orders.");
  }
  return totals;
}

/** Every referenced client/product must belong to this business. */
async function assertReferencesInTenant(tx: Db, ctx: TenantContext, order: NormalisedOrder, allowArchivedClientId?: string) {
  const client = await tx.client.findFirst({ where: { id: order.clientId, businessId: ctx.businessId } });
  if (!client) throw new ValidationError("Choose a client", { clientId: "Client not found" });
  if (client.archivedAt && client.id !== allowArchivedClientId) {
    throw new ValidationError("This client is archived. Restore them first.", { clientId: "Client is archived" });
  }
  const productIds = [...new Set(order.items.map((i) => i.productId).filter((v): v is string => !!v))];
  if (productIds.length) {
    const count = await tx.product.count({ where: { id: { in: productIds }, businessId: ctx.businessId } });
    if (count !== productIds.length) throw new ValidationError("One or more products were not found.");
  }
}

/** Count orders created this calendar month (business timezone) and compare with the plan. */
export async function assertMonthlyOrderLimit(tx: Db, ctx: TenantContext, now = new Date()) {
  const plan = await getPlan(ctx.plan);
  if (!billingEnabled() || plan.maxMonthlyOrders === null) return;
  const { start, end } = monthBoundsUtc(now, ctx.business.timezone);
  const count = await tx.order.count({ where: { businessId: ctx.businessId, createdAt: { gte: start, lt: end } } });
  if (count >= plan.maxMonthlyOrders) {
    throw new PlanLimitError(
      `Your ${plan.name} plan allows ${plan.maxMonthlyOrders} orders per month and you have reached that limit. ` +
        `Upgrade to Pro in Settings → Billing for unlimited orders.`,
    );
  }
}

export async function createOrder(ctx: TenantContext, input: OrderInput) {
  assertCan(ctx, "orders.manage");
  assertWritable(ctx);
  const order = normaliseOrderInput(ctx, input);
  const totals = totalsFor(order);

  return prisma.$transaction(async (tx) => {
    // Allocates the next tenant-scoped number and locks the business row, which
    // also serialises the monthly plan-limit check below.
    const [{ orderSequence }] = await tx.$queryRaw<{ orderSequence: number }[]>`
      UPDATE "Business" SET "orderSequence" = "orderSequence" + 1
      WHERE "id" = ${ctx.businessId} RETURNING "orderSequence"`;
    await assertMonthlyOrderLimit(tx, ctx);
    await assertReferencesInTenant(tx, ctx, order);

    const status = order.status ?? "CONFIRMED";
    const created = await tx.order.create({
      data: {
        businessId: ctx.businessId,
        number: orderSequence,
        clientId: order.clientId,
        status,
        orderDate: order.orderDate,
        fulfillmentAt: order.fulfillmentAt,
        fulfillmentType: order.fulfillmentType,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxBps: order.taxBps,
        taxMinor: totals.taxMinor,
        deliveryChargeMinor: totals.deliveryChargeMinor,
        totalMinor: totals.totalMinor,
        paidMinor: 0,
        paymentStatus: derivePaymentStatus(totals.totalMinor, 0, status),
        createdById: ctx.userId,
        items: {
          // businessId is inherited from the parent order via the composite FK.
          create: order.items.map((item, i) => ({
            productId: item.productId,
            description: item.description,
            unit: item.unit,
            quantityMilli: item.quantityMilli,
            unitPriceMinor: item.unitPriceMinor,
            lineTotalMinor: totals.lineTotals[i],
            isCustom: !item.productId,
            position: i,
          })),
        },
      },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "order.created",
      entityType: "Order",
      entityId: created.id,
      metadata: { number: created.number, totalMinor: created.totalMinor, status },
    });
    return created;
  });
}

/**
 * Updates order details and replaces its items. Items carry their own
 * description/price snapshot, so catalogue changes never alter an order
 * unless staff edit that line.
 */
export async function updateOrder(ctx: TenantContext, id: string, input: OrderInput) {
  assertCan(ctx, "orders.manage");
  assertWritable(ctx);
  const order = normaliseOrderInput(ctx, input);
  const totals = totalsFor(order);

  return prisma.$transaction(async (tx) => {
    const existing = await lockOrder(tx, ctx, id);
    if (input.expectedUpdatedAt && existing.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new ValidationError("Someone else changed this order while you were editing. Reload the page to see their changes, then try again.");
    }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new ValidationError(`A ${existing.status.toLowerCase()} order can no longer be edited.`);
    }
    await assertReferencesInTenant(tx, ctx, order, existing.clientId);
    await tx.orderItem.deleteMany({ where: { orderId: id, businessId: ctx.businessId } });
    const updated = await tx.order.update({
      where: { id: existing.id },
      data: {
        clientId: order.clientId,
        orderDate: order.orderDate,
        fulfillmentAt: order.fulfillmentAt,
        fulfillmentType: order.fulfillmentType,
        deliveryAddress: order.deliveryAddress,
        notes: order.notes,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxBps: order.taxBps,
        taxMinor: totals.taxMinor,
        deliveryChargeMinor: totals.deliveryChargeMinor,
        totalMinor: totals.totalMinor,
        paymentStatus: derivePaymentStatus(totals.totalMinor, existing.paidMinor, existing.status),
        items: {
          // businessId is inherited from the parent order via the composite FK.
          create: order.items.map((item, i) => ({
            productId: item.productId,
            description: item.description,
            unit: item.unit,
            quantityMilli: item.quantityMilli,
            unitPriceMinor: item.unitPriceMinor,
            lineTotalMinor: totals.lineTotals[i],
            isCustom: !item.productId,
            position: i,
          })),
        },
      },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "order.updated",
      entityType: "Order",
      entityId: id,
      metadata: {
        number: existing.number,
        totalMinor: { from: existing.totalMinor, to: updated.totalMinor },
        ...(existing.clientId !== updated.clientId ? { clientId: { from: existing.clientId, to: updated.clientId } } : {}),
      },
    });
    return updated;
  });
}

export async function changeOrderStatus(ctx: TenantContext, id: string, next: OrderStatus, reason?: string) {
  assertCan(ctx, "orders.manage");
  assertWritable(ctx);
  return prisma.$transaction(async (tx) => {
    const existing = await lockOrder(tx, ctx, id);
    if (existing.status === next) return existing;
    if (!STATUS_TRANSITIONS[existing.status].includes(next)) {
      throw new ValidationError(`Cannot change an order from ${existing.status} to ${next}.`);
    }
    const updated = await tx.order.update({
      where: { id: existing.id },
      data: { status: next, paymentStatus: derivePaymentStatus(existing.totalMinor, existing.paidMinor, next) },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: next === "CANCELLED" ? "order.cancelled" : "order.status_changed",
      entityType: "Order",
      entityId: id,
      metadata: { number: existing.number, from: existing.status, to: next, ...(reason ? { reason } : {}) },
    });
    return updated;
  });
}

/** Row-locks an order within the tenant (SELECT ... FOR UPDATE). */
export async function lockOrder(tx: Db, ctx: TenantContext, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Order" WHERE "id" = ${id} AND "businessId" = ${ctx.businessId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundError("Order");
  return tx.order.findFirstOrThrow({ where: { id, businessId: ctx.businessId } });
}

export async function getOrder(ctx: TenantContext, id: string) {
  assertNotSuspended(ctx);
  const order = await prisma.order.findFirst({
    where: { id, businessId: ctx.businessId },
    include: {
      client: true,
      items: { orderBy: { position: "asc" } },
      payments: { orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!order) throw new NotFoundError("Order");
  return order;
}

export interface OrderFilters {
  q?: string;
  clientId?: string;
  status?: OrderStatus | "OPEN" | "OVERDUE";
  paymentStatus?: PaymentStatus | "DUE";
  from?: string; // fulfilment date YYYY-MM-DD (business-local)
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: "fulfillment_asc" | "fulfillment_desc" | "number_desc";
}

export function buildOrderWhere(ctx: TenantContext, f: OrderFilters, now = new Date()): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [{ businessId: ctx.businessId }];
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.status === "OPEN") and.push({ status: { in: OPEN_STATUSES } });
  else if (f.status === "OVERDUE") and.push({ status: { in: ACTIVE_STATUSES }, fulfillmentAt: { lt: now } });
  else if (f.status && ORDER_STATUSES.includes(f.status)) and.push({ status: f.status });
  if (f.paymentStatus === "DUE") and.push({ paymentStatus: { in: ["UNPAID", "PARTIAL"] }, status: { not: "CANCELLED" } });
  else if (f.paymentStatus && PAYMENT_STATUSES.includes(f.paymentStatus)) and.push({ paymentStatus: f.paymentStatus });
  if (f.from && dateOnly(f.from)) and.push({ fulfillmentAt: { gte: dayBoundsUtc(f.from, ctx.business.timezone).start } });
  if (f.to && dateOnly(f.to)) and.push({ fulfillmentAt: { lt: dayBoundsUtc(f.to, ctx.business.timezone).end } });
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/^\D+/, "");
    const asNumber = /^\d+$/.test(digits) ? Number(digits) : null;
    and.push({
      OR: [
        { client: { name: { contains: q, mode: "insensitive" } } },
        { client: { phone: { contains: q } } },
        ...(asNumber !== null && asNumber < 2_000_000_000 ? [{ number: asNumber }] : []),
      ],
    });
  }
  return { AND: and };
}

export async function listOrders(ctx: TenantContext, f: OrderFilters = {}) {
  assertNotSuspended(ctx);
  const pageSize = Math.min(f.pageSize ?? 25, 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = buildOrderWhere(ctx, f);
  const orderBy: Prisma.OrderOrderByWithRelationInput[] =
    f.sort === "fulfillment_asc"
      ? [{ fulfillmentAt: "asc" }]
      : f.sort === "number_desc"
        ? [{ number: "desc" }]
        : [{ fulfillmentAt: "desc" }];
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { client: { select: { id: true, name: true, phone: true } }, _count: { select: { items: true } } },
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

/** Orders created this month vs plan limit (for usage display). */
export async function monthlyOrderUsage(ctx: TenantContext, now = new Date()) {
  const { start, end } = monthBoundsUtc(now, ctx.business.timezone);
  const used = await prisma.order.count({ where: { businessId: ctx.businessId, createdAt: { gte: start, lt: end } } });
  return { used, limit: (await getPlan(ctx.plan)).maxMonthlyOrders };
}
