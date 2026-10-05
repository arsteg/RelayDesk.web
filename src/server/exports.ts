import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/errors";
import { minorToInput, formatQuantity } from "@/lib/money";
import { dateOnlyToString, utcToZonedInput } from "@/lib/time";
import { balanceMinor } from "@/lib/totals";
import { actorOf, assertCan, type TenantContext } from "@/server/context";
import { formatOrderNumber } from "@/server/orders";

/** Quote a CSV cell and neutralise spreadsheet formula injection for text values. */
export function csvCell(value: unknown, isText = true): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: (string | number | null)[][], numericCols: Set<number> = new Set()): string {
  const lines = [header.map((h) => csvCell(h)).join(",")];
  for (const r of rows) lines.push(r.map((v, i) => csvCell(v, !numericCols.has(i))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export type ExportKind = "clients" | "orders" | "payments";

/**
 * Exports remain available in read-only mode (cancelled/expired subscription)
 * and, for owners, while suspended - customers always keep access to their data.
 */
function assertCanExport(ctx: TenantContext) {
  assertCan(ctx, "data.export");
  if (ctx.access.level === "suspended" && ctx.role !== "OWNER") {
    throw new ForbiddenError("Only the owner can export data while the workspace is suspended.");
  }
}

export async function exportCsv(ctx: TenantContext, kind: ExportKind): Promise<string> {
  assertCanExport(ctx);
  const cur = ctx.business.currency;
  const tz = ctx.business.timezone;
  const money = (m: number) => minorToInput(m, cur);
  let csv: string;

  if (kind === "clients") {
    const clients = await prisma.client.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { name: "asc" },
      include: { orders: { select: { totalMinor: true, paidMinor: true, status: true } } },
    });
    csv = toCsv(
      ["Client ID", "Name", "Phone", "Email", "Address", "Notes", "Orders", `Outstanding (${cur})`, "Archived", "Created"],
      clients.map((c) => [
        c.id, c.name, c.phone, c.email, c.address, c.notes, c.orders.length,
        money(c.orders.reduce((s, o) => s + Math.max(balanceMinor(o.totalMinor, o.paidMinor, o.status), 0), 0)),
        c.archivedAt ? "yes" : "no", c.createdAt.toISOString(),
      ]),
      new Set([6, 7]),
    );
  } else if (kind === "orders") {
    const orders = await prisma.order.findMany({
      where: { businessId: ctx.businessId },
      orderBy: { number: "asc" },
      include: { client: { select: { name: true } }, items: { orderBy: { position: "asc" } } },
    });
    csv = toCsv(
      ["Order No", "Client", "Status", "Order date", "Fulfilment", "Type", "Delivery address", "Items",
        `Subtotal (${cur})`, `Discount (${cur})`, "Tax %", `Tax (${cur})`, `Delivery (${cur})`, `Total (${cur})`,
        `Paid (${cur})`, `Balance (${cur})`, "Payment status", "Notes"],
      orders.map((o) => [
        formatOrderNumber(ctx.business.invoicePrefix, o.number), o.client.name, o.status, dateOnlyToString(o.orderDate),
        utcToZonedInput(o.fulfillmentAt, tz).replace("T", " "), o.fulfillmentType, o.deliveryAddress,
        o.items.map((i) => `${formatQuantity(i.quantityMilli)} x ${i.description} @ ${money(i.unitPriceMinor)}`).join("; "),
        money(o.subtotalMinor), money(o.discountMinor), (o.taxBps / 100).toFixed(2), money(o.taxMinor),
        money(o.deliveryChargeMinor), money(o.totalMinor), money(o.paidMinor),
        money(balanceMinor(o.totalMinor, o.paidMinor, o.status)), o.paymentStatus, o.notes,
      ]),
      new Set([8, 9, 10, 11, 12, 13, 14, 15]),
    );
  } else {
    const payments = await prisma.payment.findMany({
      where: { businessId: ctx.businessId },
      orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
      include: { order: { select: { number: true, client: { select: { name: true } } } } },
    });
    csv = toCsv(
      ["Payment ID", "Date", "Order No", "Client", "Type", `Amount (${cur})`, "Method", "Reference", "Notes", "Voided", "Void reason", "Recorded at"],
      payments.map((p) => [
        p.id, dateOnlyToString(p.paidOn), formatOrderNumber(ctx.business.invoicePrefix, p.order.number), p.order.client.name,
        p.kind, money(p.kind === "REFUND" ? -p.amountMinor : p.amountMinor), p.method, p.reference, p.notes,
        p.voidedAt ? "yes" : "no", p.voidReason, p.createdAt.toISOString(),
      ]),
      new Set([5]),
    );
  }

  await audit(prisma, {
    businessId: ctx.businessId,
    actor: actorOf(ctx),
    action: "data.exported",
    entityType: "Export",
    entityId: kind,
  });
  return csv;
}
