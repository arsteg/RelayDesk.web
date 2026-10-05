import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { MAX_MINOR } from "@/lib/limits";
import { Prisma } from "@/generated/prisma/client";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { optionalText, parseOrThrow } from "@/server/validation";

const CATEGORY_INCLUDE = { category: { select: { id: true, name: true } } } as const;

export const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  categoryId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null),
  description: optionalText(1000),
  // The business-configured pricing/billing unit (item, kg, box, litre, …).
  unit: z.string().trim().min(1, "Unit is required").max(30),
  price: z.string().trim().min(1, "Price is required"),
  isAvailable: z.boolean(),
  // Catch-weight: billed quantity captured during preparation.
  isVariableMeasure: z.boolean().optional().default(false),
  // Units a customer may order in (empty = only the pricing unit).
  orderUnits: z.array(z.string().trim().min(1).max(30)).optional().default([]),
  // Optional planning estimate of pricing-units per order-unit; blank = none.
  estConversion: z.string().trim().optional().nullable(),
});
export type ProductInput = z.input<typeof productSchema>;

function toData(ctx: TenantContext, input: ProductInput) {
  const data = parseOrThrow(productSchema, input);
  const priceMinor = parseMoneyToMinor(data.price, ctx.business.currency);
  if (priceMinor === null || priceMinor > MAX_MINOR) throw new ValidationError("Please fix the highlighted fields.", { price: "Enter a valid price" });
  let estConversionPerOrderUnit: number | null = null;
  if (data.estConversion) {
    const n = Number(data.estConversion);
    if (!Number.isInteger(n) || n <= 0) throw new ValidationError("Please fix the highlighted fields.", { estConversion: "Enter a whole number" });
    estConversionPerOrderUnit = n;
  }
  // Normalise order units: drop blanks/dupes; always allow the pricing unit.
  const units = Array.from(new Set([data.unit, ...(data.orderUnits ?? [])].map((u) => u.trim()).filter(Boolean)));
  const { price: _price, estConversion: _est, orderUnits: _ou, ...rest } = data;
  return { ...rest, priceMinor, estConversionPerOrderUnit, orderUnits: units };
}

/** A chosen category must exist in this tenant (the composite FK also enforces it). */
async function assertCategoryInTenant(tx: Db, ctx: TenantContext, categoryId: string | null) {
  if (!categoryId) return;
  const found = await tx.category.findFirst({ where: { id: categoryId, businessId: ctx.businessId }, select: { id: true } });
  if (!found) throw new ValidationError("Please fix the highlighted fields.", { categoryId: "Choose a valid category" });
}

export async function listProducts(
  ctx: TenantContext,
  opts: { q?: string; categoryId?: string; includeArchived?: boolean; availableOnly?: boolean } = {},
) {
  assertCan(ctx, "products.view");
  assertNotSuspended(ctx);
  const q = opts.q?.trim();
  const where: Prisma.ProductWhereInput = {
    businessId: ctx.businessId,
    ...(opts.includeArchived ? {} : { archivedAt: null }),
    ...(opts.availableOnly ? { isAvailable: true } : {}),
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { category: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  return prisma.product.findMany({ where, orderBy: [{ category: { name: "asc" } }, { name: "asc" }], include: CATEGORY_INCLUDE, take: 500 });
}

export async function getProduct(ctx: TenantContext, id: string) {
  assertNotSuspended(ctx);
  const product = await prisma.product.findFirst({ where: { id, businessId: ctx.businessId }, include: CATEGORY_INCLUDE });
  if (!product) throw new NotFoundError("Product");
  return product;
}

export async function createProduct(ctx: TenantContext, input: ProductInput) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  const data = toData(ctx, input);
  return prisma.$transaction(async (tx) => {
    await assertCategoryInTenant(tx, ctx, data.categoryId);
    const product = await tx.product.create({ data: { ...data, businessId: ctx.businessId } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "product.created",
      entityType: "Product",
      entityId: product.id,
      metadata: { name: product.name, priceMinor: product.priceMinor },
    });
    return product;
  });
}

/** Editing a product never changes existing orders: order items hold their own snapshot. */
export async function updateProduct(ctx: TenantContext, id: string, input: ProductInput) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  const data = toData(ctx, input);
  return prisma.$transaction(async (tx) => {
    const before = await tx.product.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!before) throw new NotFoundError("Product");
    await assertCategoryInTenant(tx, ctx, data.categoryId);
    const product = await tx.product.update({ where: { id: before.id }, data });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "product.updated",
      entityType: "Product",
      entityId: id,
      metadata: before.priceMinor !== product.priceMinor ? { priceMinor: { from: before.priceMinor, to: product.priceMinor } } : undefined,
    });
    return product;
  });
}

export async function setProductArchived(ctx: TenantContext, id: string, archived: boolean) {
  assertCan(ctx, "products.manage");
  assertWritable(ctx);
  await prisma.$transaction(async (tx) => {
    const res = await tx.product.updateMany({
      where: { id, businessId: ctx.businessId },
      data: { archivedAt: archived ? new Date() : null, ...(archived ? { isAvailable: false } : {}) },
    });
    if (res.count !== 1) throw new NotFoundError("Product");
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: archived ? "product.archived" : "product.restored",
      entityType: "Product",
      entityId: id,
    });
  });
}
