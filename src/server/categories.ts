import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { Prisma } from "@/generated/prisma/client";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { parseOrThrow } from "@/server/validation";

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});
export type CategoryInput = z.input<typeof categorySchema>;

/** Rejects a duplicate name (case-insensitive) among the business's active categories. */
async function assertNameAvailable(tx: Db, ctx: TenantContext, name: string, exceptId?: string) {
  const clash = await tx.category.findFirst({
    where: {
      businessId: ctx.businessId,
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ValidationError("A category with this name already exists.", { name: "This name is already in use" });
}

/** All categories with their product counts (for the management page). */
export async function listCategories(ctx: TenantContext, opts: { includeArchived?: boolean } = {}) {
  assertCan(ctx, "products.view");
  assertNotSuspended(ctx);
  const where: Prisma.CategoryWhereInput = {
    businessId: ctx.businessId,
    ...(opts.includeArchived ? {} : { archivedAt: null }),
  };
  const rows = await prisma.category.findMany({
    where,
    orderBy: { name: "asc" },
    include: { _count: { select: { products: { where: { archivedAt: null } } } } },
    take: 500,
  });
  return rows.map((c) => ({ ...c, productCount: c._count.products }));
}

/** Lightweight list of active categories for pickers. */
export async function categoryOptions(ctx: TenantContext) {
  assertNotSuspended(ctx);
  return prisma.category.findMany({
    where: { businessId: ctx.businessId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

export async function getCategory(ctx: TenantContext, id: string) {
  assertNotSuspended(ctx);
  const category = await prisma.category.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!category) throw new NotFoundError("Category");
  return category;
}

export async function createCategory(ctx: TenantContext, input: CategoryInput) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  const data = parseOrThrow(categorySchema, input);
  return prisma.$transaction(async (tx) => {
    await assertNameAvailable(tx, ctx, data.name);
    const category = await tx.category.create({ data: { name: data.name, businessId: ctx.businessId } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "category.created",
      entityType: "Category",
      entityId: category.id,
      metadata: { name: category.name },
    });
    return category;
  });
}

export async function updateCategory(ctx: TenantContext, id: string, input: CategoryInput) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  const data = parseOrThrow(categorySchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.category.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!before) throw new NotFoundError("Category");
    await assertNameAvailable(tx, ctx, data.name, before.id);
    const category = await tx.category.update({ where: { id: before.id }, data: { name: data.name } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "category.updated",
      entityType: "Category",
      entityId: id,
      metadata: before.name !== category.name ? { name: { from: before.name, to: category.name } } : undefined,
    });
    return category;
  });
}

/**
 * Archive (or restore) a category. Archiving keeps it out of pickers but leaves
 * existing products pointing at it, matching how archived clients/products behave.
 */
export async function setCategoryArchived(ctx: TenantContext, id: string, archived: boolean) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.category.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!before) throw new NotFoundError("Category");
    // Restoring must not collide with a category that reused the name meanwhile.
    if (!archived && before.archivedAt) await assertNameAvailable(tx, ctx, before.name, before.id);
    const res = await tx.category.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (res.count !== 1) throw new NotFoundError("Category");
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: archived ? "category.archived" : "category.restored",
      entityType: "Category",
      entityId: id,
    });
  });
}
