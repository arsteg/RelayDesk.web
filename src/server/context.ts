import { prisma, type Db } from "@/lib/db";
import type { Plan, Role } from "@/generated/prisma/enums";
import { ForbiddenError, ReadOnlyError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";
import { computeAccess, effectivePlan, type WorkspaceAccess } from "@/lib/plans";

/**
 * The only source of tenant identity for the service layer.
 * Built from a verified Membership row - never from request input.
 */
export interface TenantContext {
  userId: string;
  userEmail: string;
  businessId: string;
  role: Role;
  business: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    defaultTaxBps: number;
    invoicePrefix: string;
  };
  access: WorkspaceAccess;
  plan: Plan;
}

/** Returns null when the user is not a member of the business. */
export async function loadTenantContext(userId: string, businessId: string, db: Db = prisma): Promise<TenantContext | null> {
  const membership = await db.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
    include: {
      user: { select: { email: true } },
      // Explicit select: never load logo bytes on the per-request hot path.
      business: {
        select: {
          id: true, name: true, currency: true, timezone: true, defaultTaxBps: true, invoicePrefix: true,
          suspendedAt: true, suspendedReason: true, subscription: true,
        },
      },
    },
  });
  if (!membership) return null;
  const { business, user } = membership;
  return {
    userId,
    userEmail: user.email,
    businessId: business.id,
    role: membership.role,
    business: {
      id: business.id,
      name: business.name,
      currency: business.currency,
      timezone: business.timezone,
      defaultTaxBps: business.defaultTaxBps,
      invoicePrefix: business.invoicePrefix,
    },
    access: computeAccess(business.subscription, business),
    plan: effectivePlan(business.subscription),
  };
}

export function assertCan(ctx: TenantContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError();
}

/** Blocks reads for suspended workspaces (except where explicitly allowed). */
export function assertNotSuspended(ctx: TenantContext) {
  if (ctx.access.level === "suspended") throw new ReadOnlyError(ctx.access.reason ?? "Workspace suspended.");
}

/** Blocks mutations of business data when the workspace is read-only or suspended. */
export function assertWritable(ctx: TenantContext) {
  if (ctx.access.level !== "full") {
    throw new ReadOnlyError(ctx.access.reason ?? "This workspace is read-only.");
  }
}

export function actorOf(ctx: TenantContext) {
  return { userId: ctx.userId, email: ctx.userEmail };
}
