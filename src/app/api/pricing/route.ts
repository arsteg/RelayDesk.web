import { getTenant } from "@/lib/auth/current";
import { prisma } from "@/lib/db";
import { resolvePricesForClient } from "@/server/pricing";

/**
 * Resolved per-customer unit prices for the order form, keyed by productId.
 * Falls back to each product's default price when the client has no override.
 */
export async function GET(req: Request) {
  const ctx = await getTenant();
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) return Response.json({ prices: {} });

  const products = await prisma.product.findMany({
    where: { businessId: ctx.businessId, archivedAt: null },
    select: { id: true, priceMinor: true },
  });
  const resolved = await resolvePricesForClient(prisma, ctx.businessId, clientId, products);
  return new Response(JSON.stringify({ prices: Object.fromEntries(resolved) }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
