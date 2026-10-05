import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { generateToken, hashToken } from "@/lib/auth/crypto";
import { SESSION_TTL_DAYS, sessionCookieName, sessionCookieOptions } from "@/lib/auth/cookie";
import { clientIpFromHeaders } from "@/lib/request-ip";

const RENEW_WHEN_DAYS_LEFT = 15;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFromHeaders((n) => h.get(n));
}

export async function createSession(userId: string, activeBusinessId?: string | null) {
  const token = generateToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeBusinessId: activeBusinessId ?? null,
      expiresAt,
      ipAddress: await clientIp(),
      userAgent: h.get("user-agent")?.slice(0, 255) ?? null,
    },
  });
  const jar = await cookies();
  jar.set(sessionCookieName(), token, sessionCookieOptions(expiresAt));
}

/** Current session + user, memoised per request. Expired sessions are ignored. */
export const getSession = cache(async () => {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // Sliding renewal in the DB; the proxy keeps the cookie's expiry in step.
  if (session.expiresAt.getTime() - Date.now() < RENEW_WHEN_DAYS_LEFT * 86400_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86400_000) } })
      .catch(() => undefined);
  }
  return session;
});

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(sessionCookieName());
}

export async function setActiveBusiness(sessionId: string, businessId: string | null) {
  await prisma.session.update({ where: { id: sessionId }, data: { activeBusinessId: businessId } });
}
