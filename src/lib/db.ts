import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const max = Number(process.env.DATABASE_POOL_MAX ?? 10);
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: Number.isFinite(max) && max > 0 ? max : 10, connectionTimeoutMillis: 10_000 }),
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Create the client on first real use. Importing this module must never touch
 * the database or require DATABASE_URL, so `next build` can statically analyse
 * routes (e.g. /api/export/[kind]) without a connection string present.
 */
function getClient(): PrismaClient {
  const client = globalForPrisma.prisma ?? createClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

// A lazy proxy keeps the `import { prisma }` API unchanged everywhere while
// deferring construction (and the DATABASE_URL check) until a property is used.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
