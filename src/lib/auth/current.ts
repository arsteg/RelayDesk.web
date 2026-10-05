import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadTenantContext, assertCan, type TenantContext } from "@/server/context";
import type { Permission } from "@/lib/permissions";

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function requireVerifiedUser() {
  const user = await requireUser();
  if (!user.emailVerifiedAt) redirect("/verify-email");
  return user;
}

/**
 * Resolves the tenant for this request from the session's active business,
 * re-checked against Membership. Redirects to the workspace picker if the
 * user has no valid active workspace.
 */
export const getTenant = cache(async (): Promise<TenantContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.emailVerifiedAt) redirect("/verify-email");
  if (!session.activeBusinessId) redirect("/workspaces");
  const ctx = await loadTenantContext(session.userId, session.activeBusinessId);
  if (!ctx) {
    // Membership was removed - clear the stale selection.
    await prisma.session.update({ where: { id: session.id }, data: { activeBusinessId: null } });
    redirect("/workspaces");
  }
  return ctx;
});

/** Tenant context for pages; redirects to the dashboard when the role lacks the permission. */
export async function requireTenantPage(permission?: Permission): Promise<TenantContext> {
  const ctx = await getTenant();
  if (ctx.access.level === "suspended") redirect("/suspended");
  if (permission) {
    try {
      assertCan(ctx, permission);
    } catch {
      redirect("/app?denied=1");
    }
  }
  return ctx;
}
