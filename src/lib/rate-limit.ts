import { prisma, type Db } from "@/lib/db";
import { RateLimitError } from "@/lib/errors";

/**
 * Fixed-window rate limiter stored in Postgres so it works across instances.
 * Atomic via a single upsert-style SQL statement.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  db: Db = prisma,
): Promise<{ allowed: boolean; remaining: number }> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}::int)
                     THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}::int)
                     THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const { allowed } = await rateLimit(key, limit, windowSeconds);
  if (!allowed) throw new RateLimitError(message);
}

export const LIMITS = {
  loginPerIp: [20, 15 * 60],
  // Strict per (email, IP) so an attacker can't lock a user out from elsewhere;
  // a looser per-email ceiling still caps distributed guessing.
  loginPerEmailIp: [8, 15 * 60],
  loginPerEmail: [50, 60 * 60],
  registerPerIp: [5, 60 * 60],
  passwordResetPerIp: [5, 15 * 60],
  passwordResetPerEmail: [3, 60 * 60],
  verifyResendPerUser: [3, 60 * 60],
  invitePerUser: [20, 60 * 60],
  inviteAcceptPerIp: [20, 15 * 60],
  changePasswordPerUser: [5, 15 * 60],
  createWorkspacePerUser: [5, 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;
