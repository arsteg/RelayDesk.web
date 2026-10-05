import { prisma } from "@/lib/db";
import { addDaysYmd, zonedDateString } from "@/lib/time";
import { hashPassword } from "@/lib/auth/crypto";
import type { Role } from "@/generated/prisma/enums";
import { createBusinessWithOwner } from "@/server/auth";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { createClient } from "@/server/clients";
import { createProduct } from "@/server/products";
import { createOrder, type OrderInput } from "@/server/orders";

let passwordHash: string | null = null;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function createUser(email: string, opts: { verified?: boolean; platformAdmin?: boolean } = {}) {
  passwordHash ??= await hashPassword("correct horse battery");
  return prisma.user.create({
    data: {
      email,
      name: email.split("@")[0],
      passwordHash,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      isPlatformAdmin: opts.platformAdmin ?? false,
    },
  });
}

export async function ctx(userId: string, businessId: string): Promise<TenantContext> {
  const c = await loadTenantContext(userId, businessId);
  if (!c) throw new Error("not a member");
  return c;
}

/** A business with an owner, plus helpers to add members. */
export async function setupBusiness(name: string, ownerEmail: string) {
  const owner = await createUser(ownerEmail);
  const { businessId } = await createBusinessWithOwner(owner.id, name);
  return {
    businessId,
    owner,
    ownerCtx: () => ctx(owner.id, businessId),
    async addMember(email: string, role: Role) {
      const user = await createUser(email);
      await prisma.membership.create({ data: { userId: user.id, businessId, role } });
      return { user, ctx: () => ctx(user.id, businessId) };
    },
  };
}

/** Local (Asia/Kolkata) datetime-local string `daysFromNow` days ahead at `hour`. */
export function fulfilment(daysFromNow = 1, hour = "10:00") {
  return `${addDaysYmd(today(), daysFromNow)}T${hour}`;
}

/** Today's date in the businesses' default timezone. */
export function today() {
  return zonedDateString(new Date(), "Asia/Kolkata");
}

/** Creates a client + product + confirmed order (2 x 500.00, total 1000.00 by default). */
export async function seedOrder(c: TenantContext, overrides: Partial<OrderInput> = {}) {
  const client = await createClient(c, { name: `Client of ${c.business.name}`, phone: "9876543210" });
  const product = await createProduct(c, { name: `Cake of ${c.business.name}`, unit: "piece", price: "500", isAvailable: true });
  const order = await createOrder(c, {
    clientId: client.id,
    orderDate: today(),
    fulfillmentAt: fulfilment(),
    fulfillmentType: "PICKUP",
    items: [{ productId: product.id, description: product.name, quantity: "2", unitPrice: "500" }],
    ...overrides,
  });
  return { client, product, order };
}
