import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { generateToken, hashToken } from "@/lib/auth/crypto";
import { appUrl, trySendEmail } from "@/lib/email";
import { ForbiddenError, NotFoundError, PlanLimitError, ValidationError } from "@/lib/errors";
import { canManageRole, ROLE_LABELS } from "@/lib/permissions";
import { billingEnabled } from "@/lib/features";
import { getPlan } from "@/lib/plans";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { RateLimitError } from "@/lib/errors";
import type { Role } from "@/generated/prisma/enums";
import { actorOf, assertCan, assertNotSuspended, assertWritable, type TenantContext } from "@/server/context";
import { parseOrThrow } from "@/server/validation";

const INVITE_TTL_DAYS = 7;

export async function listMembers(ctx: TenantContext) {
  assertCan(ctx, "members.view");
  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { businessId: ctx.businessId },
      include: { user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.invitation.findMany({
      where: { businessId: ctx.businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invitations };
}

/** Seats used = members + pending (unexpired) invitations. */
export async function seatUsage(db: Db, businessId: string) {
  const [members, pending] = await Promise.all([
    db.membership.count({ where: { businessId } }),
    db.invitation.count({ where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { members, pending, used: members + pending };
}

export async function assertSeatAvailable(db: Db, ctx: TenantContext) {
  const plan = await getPlan(ctx.plan);
  if (!billingEnabled() || plan.maxMembers === null) return;
  const { used } = await seatUsage(db, ctx.businessId);
  if (used >= plan.maxMembers) {
    throw new PlanLimitError(
      `Your ${plan.name} plan includes ${plan.maxMembers} team members (including pending invitations). ` +
        `Upgrade to Pro in Settings → Billing to add more staff, or revoke an unused invitation.`,
    );
  }
}

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  role: z.enum(["ADMIN", "STAFF"]),
});

export async function inviteMember(ctx: TenantContext, input: z.input<typeof inviteSchema>) {
  assertCan(ctx, "members.manage");
  assertWritable(ctx);
  const data = parseOrThrow(inviteSchema, input);
  if (!canManageRole(ctx.role, data.role)) {
    throw new ForbiddenError(`Only the owner can invite ${ROLE_LABELS[data.role].toLowerCase()}s.`);
  }
  const [max, windowSec] = LIMITS.invitePerUser;
  if (!(await rateLimit(`invite:${ctx.userId}`, max, windowSec)).allowed) throw new RateLimitError();

  const token = generateToken();
  const invitation = await prisma.$transaction(async (tx) => {
    // Lock the business row so concurrent invites cannot exceed the seat limit.
    await tx.$queryRaw`SELECT "id" FROM "Business" WHERE "id" = ${ctx.businessId} FOR UPDATE`;
    const existingMember = await tx.membership.findFirst({
      where: { businessId: ctx.businessId, user: { email: data.email } },
    });
    if (existingMember) throw new ValidationError("This person is already a member.", { email: "Already a member" });
    // Re-inviting replaces any earlier pending invitation for this email.
    await tx.invitation.updateMany({
      where: { businessId: ctx.businessId, email: data.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await assertSeatAvailable(tx, ctx);
    const inv = await tx.invitation.create({
      data: {
        businessId: ctx.businessId,
        email: data.email,
        role: data.role,
        tokenHash: hashToken(token),
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000),
      },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "invitation.created",
      entityType: "Invitation",
      entityId: inv.id,
      metadata: { email: data.email, role: data.role },
    });
    return inv;
  });

  const inviteUrl = appUrl(`/invite/${token}`);
  const emailSent = await trySendEmail({
    to: data.email,
    subject: `You're invited to ${ctx.business.name} on RelayDesk`,
    text:
      `${ctx.userEmail} invited you to join ${ctx.business.name} on RelayDesk as ${ROLE_LABELS[data.role]}.\n\n` +
      `Accept the invitation:\n${inviteUrl}\n\nThis link expires in ${INVITE_TTL_DAYS} days.`,
  });
  // If delivery failed the inviter gets the link to share another way.
  return { invitation, token, emailSent, inviteUrl };
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string) {
  assertCan(ctx, "members.manage");
  assertNotSuspended(ctx);
  await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findFirst({ where: { id: invitationId, businessId: ctx.businessId } });
    if (!inv) throw new NotFoundError("Invitation");
    if (!canManageRole(ctx.role, inv.role)) throw new ForbiddenError();
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "invitation.revoked",
      entityType: "Invitation",
      entityId: inv.id,
      metadata: { email: inv.email },
    });
  });
}

async function findMembership(db: Db, ctx: TenantContext, membershipId: string) {
  const m = await db.membership.findFirst({
    where: { id: membershipId, businessId: ctx.businessId },
    include: { user: { select: { email: true, emailVerifiedAt: true } } },
  });
  if (!m) throw new NotFoundError("Member");
  return m;
}

export async function changeMemberRole(ctx: TenantContext, membershipId: string, role: Role) {
  assertCan(ctx, "members.manage");
  assertNotSuspended(ctx);
  if (role === "OWNER") throw new ValidationError("Use ownership transfer to make someone the owner.");
  await prisma.$transaction(async (tx) => {
    const m = await findMembership(tx, ctx, membershipId);
    if (m.userId === ctx.userId) throw new ValidationError("You cannot change your own role.");
    if (!canManageRole(ctx.role, m.role) || !canManageRole(ctx.role, role)) throw new ForbiddenError();
    if (m.role === role) return;
    await tx.membership.update({ where: { id: m.id }, data: { role } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "member.role_changed",
      entityType: "Membership",
      entityId: m.id,
      metadata: { email: m.user.email, from: m.role, to: role },
    });
  });
}

export async function removeMember(ctx: TenantContext, membershipId: string) {
  assertCan(ctx, "members.manage");
  assertNotSuspended(ctx);
  await prisma.$transaction(async (tx) => {
    const m = await findMembership(tx, ctx, membershipId);
    if (m.userId === ctx.userId) throw new ValidationError("You cannot remove yourself.");
    if (!canManageRole(ctx.role, m.role)) throw new ForbiddenError();
    await tx.membership.delete({ where: { id: m.id } });
    // Drop the workspace selection from that user's sessions.
    await tx.session.updateMany({ where: { userId: m.userId, activeBusinessId: ctx.businessId }, data: { activeBusinessId: null } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "member.removed",
      entityType: "Membership",
      entityId: m.id,
      metadata: { email: m.user.email, role: m.role },
    });
  });
}

/** The owner hands ownership to another member and becomes an Admin. */
export async function transferOwnership(ctx: TenantContext, membershipId: string) {
  assertCan(ctx, "ownership.transfer");
  assertNotSuspended(ctx);
  await prisma.$transaction(async (tx) => {
    const target = await findMembership(tx, ctx, membershipId);
    if (target.userId === ctx.userId) throw new ValidationError("You already own this workspace.");
    if (!target.user.emailVerifiedAt) throw new ValidationError("The new owner must have a verified email address.");
    await tx.membership.update({ where: { id: target.id }, data: { role: "OWNER" } });
    await tx.membership.update({
      where: { userId_businessId: { userId: ctx.userId, businessId: ctx.businessId } },
      data: { role: "ADMIN" },
    });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "ownership.transferred",
      entityType: "Membership",
      entityId: target.id,
      metadata: { to: target.user.email, from: ctx.userEmail },
    });
  });
}

/** A non-owner leaves a workspace voluntarily. */
export async function leaveBusiness(ctx: TenantContext) {
  if (ctx.role === "OWNER") throw new ValidationError("Transfer ownership before leaving this workspace.");
  assertNotSuspended(ctx);
  await prisma.$transaction(async (tx) => {
    await tx.membership.delete({ where: { userId_businessId: { userId: ctx.userId, businessId: ctx.businessId } } });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "member.left",
      entityType: "Membership",
      entityId: null,
      metadata: { email: ctx.userEmail },
    });
  });
}

export async function listAuditLog(ctx: TenantContext, opts: { page?: number; action?: string } = {}) {
  assertCan(ctx, "audit.view");
  const pageSize = 50;
  const page = Math.max(opts.page ?? 1, 1);
  const where = {
    businessId: ctx.businessId,
    ...(opts.action ? { action: { startsWith: opts.action } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
