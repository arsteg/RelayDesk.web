import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { MAX_MINOR } from "@/lib/limits";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";

/**
 * Per-customer pricing. A customer's negotiated price for a product (in the
 * product's configured unit) overrides the product's default `priceMinor`.
 * The resolved price is snapshotted onto the order line at placement, so later
 * price-list edits never change existing orders.
 */

/** Resolve the unit price for (client, product): customer price, else the product default. */
export async function resolveUnitPriceMinor(db: Db, businessId: string, clientId: string, productId: string, defaultPriceMinor: number): Promise<number> {
  const row = await db.customerPrice.findUnique({
    where: { businessId_clientId_productId: { businessId, clientId, productId } },
    select: { priceMinor: true },
  });
  return row ? row.priceMinor : defaultPriceMinor;
}

/** Resolve prices for many products at once (map productId -> effective priceMinor). */
export async function resolvePricesForClient(
  db: Db,
  businessId: string,
  clientId: string,
  products: { id: string; priceMinor: number }[],
): Promise<Map<string, number>> {
  const ids = products.map((p) => p.id);
  const custom = ids.length
    ? await db.customerPrice.findMany({ where: { businessId, clientId, productId: { in: ids } }, select: { productId: true, priceMinor: true } })
    : [];
  const byProduct = new Map(custom.map((c) => [c.productId, c.priceMinor]));
  return new Map(products.map((p) => [p.id, byProduct.get(p.id) ?? p.priceMinor]));
}

/** The customer's full price list: every active product with its effective price and whether it's a custom override. */
export async function listCustomerPrices(ctx: TenantContext, clientId: string) {
  assertCan(ctx, "pricing.manage");
  assertNotSuspended(ctx);
  const client = await prisma.client.findFirst({ where: { id: clientId, businessId: ctx.businessId }, select: { id: true, name: true } });
  if (!client) throw new NotFoundError("Client");
  const [products, custom] = await Promise.all([
    prisma.product.findMany({
      where: { businessId: ctx.businessId, archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, unit: true, priceMinor: true },
    }),
    prisma.customerPrice.findMany({ where: { businessId: ctx.businessId, clientId }, select: { productId: true, priceMinor: true } }),
  ]);
  const byProduct = new Map(custom.map((c) => [c.productId, c.priceMinor]));
  return {
    client,
    rows: products.map((p) => ({
      productId: p.id,
      name: p.name,
      unit: p.unit,
      defaultPriceMinor: p.priceMinor,
      customPriceMinor: byProduct.get(p.id) ?? null,
      effectivePriceMinor: byProduct.get(p.id) ?? p.priceMinor,
    })),
  };
}

/** Set (or clear, when price is blank) a customer's price for a product. */
export async function setCustomerPrice(ctx: TenantContext, clientId: string, productId: string, price: string | null) {
  assertCan(ctx, "pricing.manage");
  assertWritable(ctx);
  return prisma.$transaction(async (tx) => {
    const [client, product] = await Promise.all([
      tx.client.findFirst({ where: { id: clientId, businessId: ctx.businessId }, select: { id: true } }),
      tx.product.findFirst({ where: { id: productId, businessId: ctx.businessId }, select: { id: true } }),
    ]);
    if (!client) throw new NotFoundError("Client");
    if (!product) throw new NotFoundError("Product");

    const trimmed = (price ?? "").trim();
    if (trimmed === "") {
      await tx.customerPrice.deleteMany({ where: { businessId: ctx.businessId, clientId, productId } });
      await audit(tx, { businessId: ctx.businessId, actor: actorOf(ctx), action: "pricing.cleared", entityType: "CustomerPrice", entityId: `${clientId}:${productId}`, metadata: { clientId, productId } });
      return { cleared: true as const };
    }
    const priceMinor = parseMoneyToMinor(trimmed, ctx.business.currency);
    if (priceMinor === null || priceMinor < 0 || priceMinor > MAX_MINOR) {
      throw new ValidationError("Please fix the highlighted fields.", { price: "Enter a valid price" });
    }
    await tx.customerPrice.upsert({
      where: { businessId_clientId_productId: { businessId: ctx.businessId, clientId, productId } },
      update: { priceMinor },
      create: { businessId: ctx.businessId, clientId, productId, priceMinor },
    });
    await audit(tx, { businessId: ctx.businessId, actor: actorOf(ctx), action: "pricing.set", entityType: "CustomerPrice", entityId: `${clientId}:${productId}`, metadata: { clientId, productId, priceMinor } });
    return { priceMinor };
  });
}
