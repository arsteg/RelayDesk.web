import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { Prisma } from "@/generated/prisma/client";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { optionalEmail, optionalPhone, optionalText, parseOrThrow } from "@/server/validation";
import { balanceMinor } from "@/lib/totals";

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(500),
  notes: optionalText(2000),
});
export type ClientInput = z.input<typeof clientSchema>;

export async function listClients(
  ctx: TenantContext,
  opts: { q?: string; includeArchived?: boolean; page?: number; pageSize?: number } = {},
) {
  assertNotSuspended(ctx);
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const q = opts.q?.trim();
  const where: Prisma.ClientWhereInput = {
    businessId: ctx.businessId,
    ...(opts.includeArchived ? {} : { archivedAt: null }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.client.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.client.count({ where }),
  ]);
  // One aggregate query for the page instead of loading every order.
  const ids = rows.map((r) => r.id);
  const stats = ids.length
    ? await prisma.$queryRaw<{ clientId: string; orders: bigint; outstanding: bigint }[]>`
        SELECT "clientId", COUNT(*)::bigint AS orders,
               COALESCE(SUM(GREATEST("totalMinor" - "paidMinor", 0)), 0)::bigint AS outstanding
        FROM "Order"
        WHERE "businessId" = ${ctx.businessId} AND "status" <> 'CANCELLED' AND "clientId" = ANY(${ids})
        GROUP BY "clientId"`
    : [];
  const byId = new Map(stats.map((s) => [s.clientId, s]));
  return {
    total,
    page,
    pageSize,
    rows: rows.map((c) => ({
      ...c,
      orderCount: Number(byId.get(c.id)?.orders ?? 0),
      outstandingMinor: Number(byId.get(c.id)?.outstanding ?? 0),
    })),
  };
}

/** Lightweight list for pickers (active clients only). */
export async function clientOptions(ctx: TenantContext) {
  assertNotSuspended(ctx);
  return prisma.client.findMany({
    where: { businessId: ctx.businessId, archivedAt: null },
    select: { id: true, name: true, phone: true, address: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
}

export async function getClient(ctx: TenantContext, id: string) {
  assertNotSuspended(ctx);
  const client = await prisma.client.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!client) throw new NotFoundError("Client");
  return client;
}

export async function getClientDetail(ctx: TenantContext, id: string) {
  const client = await getClient(ctx, id);
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: { businessId: ctx.businessId, clientId: client.id },
      orderBy: { fulfillmentAt: "desc" },
      take: 200,
    }),
    prisma.payment.findMany({
      where: { businessId: ctx.businessId, order: { clientId: client.id } },
      include: { order: { select: { id: true, number: true } } },
      orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);
  const active = orders.filter((o) => o.status !== "CANCELLED");
  const summary = {
    totalBilledMinor: active.reduce((s, o) => s + o.totalMinor, 0),
    totalPaidMinor: orders.reduce((s, o) => s + o.paidMinor, 0),
    outstandingMinor: orders.reduce((s, o) => s + Math.max(balanceMinor(o.totalMinor, o.paidMinor, o.status), 0), 0),
    refundDueMinor: orders.reduce((s, o) => s + Math.max(-balanceMinor(o.totalMinor, o.paidMinor, o.status), 0), 0),
  };
  return { client, orders, payments, summary };
}

export async function createClient(ctx: TenantContext, input: ClientInput) {
  assertCan(ctx, "clients.manage");
  assertWritable(ctx);
  const data = parseOrThrow(clientSchema, input);
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { ...data, businessId: ctx.businessId } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "client.created",
      entityType: "Client",
      entityId: client.id,
      metadata: { name: client.name },
    });
    return client;
  });
}

export async function updateClient(ctx: TenantContext, id: string, input: ClientInput) {
  assertCan(ctx, "clients.manage");
  assertWritable(ctx);
  const data = parseOrThrow(clientSchema, input);
  return prisma.$transaction(async (tx) => {
    // updateMany with businessId in the filter: a foreign id simply matches nothing.
    const res = await tx.client.updateMany({ where: { id, businessId: ctx.businessId }, data });
    if (res.count !== 1) throw new NotFoundError("Client");
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "client.updated",
      entityType: "Client",
      entityId: id,
    });
    return tx.client.findFirstOrThrow({ where: { id, businessId: ctx.businessId } });
  });
}

export async function setClientArchived(ctx: TenantContext, id: string, archived: boolean) {
  assertCan(ctx, "clients.manage");
  assertWritable(ctx);
  await prisma.$transaction(async (tx) => {
    const res = await tx.client.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (res.count !== 1) throw new NotFoundError("Client");
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: archived ? "client.archived" : "client.restored",
      entityType: "Client",
      entityId: id,
    });
  });
}
