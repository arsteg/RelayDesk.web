import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { trySendEmail } from "@/lib/email";
import { formatDateTime } from "@/lib/time";
import { formatOrderNumber } from "@/server/orders";
import { getDashboard } from "@/server/dashboard";
import { loadTenantContext, type TenantContext } from "@/server/context";

/**
 * Background jobs run per business with a tenant context derived from a real
 * membership (the owner's), so they go through exactly the same tenant-scoped
 * service functions as user requests. A job never queries across tenants.
 */
async function ownerContext(businessId: string): Promise<TenantContext | null> {
  const owner = await prisma.membership.findFirst({ where: { businessId, role: "OWNER" }, select: { userId: true } });
  return owner ? loadTenantContext(owner.userId, businessId) : null;
}

export interface DigestResult {
  businessId: string;
  recipients: string[];
  todayOrderIds: string[];
  overdueOrderIds: string[];
  outstandingMinor: number;
}

export async function buildDailyDigest(ctx: TenantContext, now = new Date()) {
  const d = await getDashboard(ctx, now);
  const cur = ctx.business.currency;
  const tz = ctx.business.timezone;
  const line = (o: (typeof d.todayOrders)[number]) =>
    `  • ${formatOrderNumber(ctx.business.invoicePrefix, o.number)} ${o.client.name} - ${formatDateTime(o.fulfillmentAt, tz)} (${o.fulfillmentType.toLowerCase()}) ${formatMoney(o.totalMinor, cur)}`;
  const text = [
    `Good morning from RelayDesk - here is ${ctx.business.name} for ${d.todayYmd}.`,
    ``,
    `Orders due today: ${d.todayOrders.length}`,
    ...d.todayOrders.map(line),
    ``,
    `Overdue orders: ${d.overdueCount}`,
    ...d.overdue.map(line),
    ``,
    `Outstanding balances: ${formatMoney(d.outstandingMinor, cur)} across ${d.outstandingOrders} orders`,
    `Collected this month: ${formatMoney(d.collectedMonthMinor, cur)}`,
  ].join("\n");
  return { dashboard: d, text };
}

export async function runDailyDigests(now = new Date(), opts: { send?: boolean } = { send: true }): Promise<DigestResult[]> {
  const businesses = await prisma.business.findMany({ where: { suspendedAt: null }, select: { id: true } });
  const results: DigestResult[] = [];
  for (const { id } of businesses) {
    try {
      const ctx = await ownerContext(id);
      if (!ctx || ctx.access.level === "suspended") continue;
      const { dashboard, text } = await buildDailyDigest(ctx, now);
      const recipients = (
        await prisma.membership.findMany({
          where: { businessId: ctx.businessId, role: { in: ["OWNER", "ADMIN"] }, user: { emailVerifiedAt: { not: null } } },
          select: { user: { select: { email: true } } },
        })
      ).map((m) => m.user.email);
      if (opts.send && (dashboard.todayOrders.length || dashboard.overdueCount)) {
        for (const to of recipients) await trySendEmail({ to, subject: `${ctx.business.name}: today's orders`, text });
      }
      results.push({
        businessId: ctx.businessId,
        recipients,
        todayOrderIds: dashboard.todayOrders.map((o) => o.id),
        overdueOrderIds: dashboard.overdue.map((o) => o.id),
        outstandingMinor: dashboard.outstandingMinor,
      });
    } catch (err) {
      console.error(`[jobs] daily digest failed for business ${id}`, err);
    }
  }
  return results;
}

/** Housekeeping: drop expired sessions/tokens and stale rate-limit buckets. */
export async function runCleanup(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 86400_000);
  const [sessions, tokens, buckets] = await Promise.all([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.authToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
    prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: dayAgo } } }),
  ]);
  return { sessions: sessions.count, tokens: tokens.count, rateLimitBuckets: buckets.count };
}

export async function runDailyJobs(now = new Date()) {
  const digests = await runDailyDigests(now);
  const cleanup = await runCleanup(now);
  return { digests: digests.length, cleanup };
}
