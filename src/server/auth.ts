import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { burnPasswordCheck, generateToken, hashPassword, hashToken, verifyPassword } from "@/lib/auth/crypto";
import { appUrl, trySendEmail } from "@/lib/email";
import { ValidationError } from "@/lib/errors";
import { TRIAL_DAYS, TRIAL_PLAN } from "@/lib/plans";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .refine((p) => new TextEncoder().encode(p).length <= 72, "Use at most 72 bytes (bcrypt limit)");
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
export const nameSchema = z.string().trim().min(1, "Required").max(120).regex(NO_CONTROL_CHARS, "Contains invalid characters");

const VERIFY_TTL_HOURS = 48;
const RESET_TTL_MINUTES = 60;

export async function createBusinessWithOwner(
  userId: string,
  businessName: string,
  db = prisma,
): Promise<{ businessId: string }> {
  const name = nameSchema.parse(businessName);
  return db.$transaction(async (tx) => {
    const business = await tx.business.create({ data: { name } });
    await tx.membership.create({ data: { userId, businessId: business.id, role: "OWNER" } });
    await tx.subscription.create({
      data: {
        businessId: business.id,
        plan: TRIAL_PLAN,
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS() * 86400_000),
      },
    });
    await audit(tx, {
      businessId: business.id,
      actor: { userId },
      action: "business.created",
      entityType: "Business",
      entityId: business.id,
      metadata: { name },
    });
    return { businessId: business.id };
  });
}

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  businessName: nameSchema,
});

export async function registerOwner(input: z.infer<typeof registerSchema>) {
  const data = registerSchema.parse(input);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new ValidationError("An account with this email already exists.", {
      email: "An account with this email already exists. Try signing in.",
    });
  }
  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({ data: { email: data.email, name: data.name, passwordHash } });
  const { businessId } = await createBusinessWithOwner(user.id, data.businessName);
  await audit(prisma, { businessId: null, actor: { userId: user.id, email: user.email }, scope: "user", action: "user.registered", entityType: "User", entityId: user.id });
  // A mail outage must not fail registration; the user can resend from the verify page.
  await sendVerificationEmail(user.id);
  return { user, businessId };
}

/** Registration for someone accepting an invitation: email is proven by the invite token. */
export async function registerInvitedUser(input: { name: string; password: string; inviteToken: string }) {
  const name = nameSchema.parse(input.name);
  const password = passwordSchema.parse(input.password);
  const invite = await findUsableInvitation(input.inviteToken);
  if (!invite) throw new ValidationError("This invitation is invalid or has expired.");
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) throw new ValidationError("An account already exists for this email. Sign in to accept the invitation.");
  const user = await prisma.user.create({
    data: { email: invite.email, name, passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  await acceptInvitation(input.inviteToken, user.id);
  return { user, businessId: invite.businessId };
}

export async function authenticate(emailInput: string, password: string) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) {
    await burnPasswordCheck(password);
    return null;
  }
  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (!user) {
    await burnPasswordCheck(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

async function issueToken(userId: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", ttlMs: number) {
  const token = generateToken();
  await prisma.$transaction([
    // Only the newest token of each type is valid.
    prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.authToken.create({
      data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

async function consumeToken(token: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET", db: Db = prisma) {
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
  // Conditional update guards against double use.
  const res = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return res.count === 1 ? row : null;
}

/** Returns false if the email could not be delivered (the user can resend). */
export async function sendVerificationEmail(userId: string): Promise<boolean> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return true;
  const token = await issueToken(userId, "EMAIL_VERIFICATION", VERIFY_TTL_HOURS * 3600_000);
  const link = appUrl(`/verify-email/confirm?token=${encodeURIComponent(token)}`);
  return trySendEmail({
    to: user.email,
    subject: "Verify your RelayDesk email",
    text: `Hi ${user.name},\n\nConfirm your email address to start using RelayDesk:\n${link}\n\nThis link expires in ${VERIFY_TTL_HOURS} hours.`,
  });
}

export async function verifyEmail(token: string): Promise<boolean> {
  // Consume the token and apply the effect in one transaction so a failure
  // mid-way rolls back the single-use marking and the link stays usable.
  return prisma.$transaction(async (tx) => {
    const row = await consumeToken(token, "EMAIL_VERIFICATION", tx);
    if (!row) return false;
    await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    await audit(tx, { businessId: null, actor: { userId: row.userId }, scope: "user", action: "user.email_verified", entityType: "User", entityId: row.userId });
    return true;
  });
}

/** Always resolves silently so the endpoint does not reveal which emails exist. */
export async function requestPasswordReset(emailInput: string) {
  const email = emailSchema.safeParse(emailInput);
  if (!email.success) return;
  const user = await prisma.user.findUnique({ where: { email: email.data } });
  if (!user) return;
  const token = await issueToken(user.id, "PASSWORD_RESET", RESET_TTL_MINUTES * 60_000);
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await audit(prisma, { businessId: null, actor: { userId: user.id, email: user.email }, scope: "user", action: "user.password_reset_requested", entityType: "User", entityId: user.id });
  await trySendEmail({
    to: user.email,
    subject: "Reset your RelayDesk password",
    text: `Hi ${user.name},\n\nReset your password using this link (valid for ${RESET_TTL_MINUTES} minutes):\n${link}\n\nIf you did not request this, you can ignore this email.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const password = passwordSchema.parse(newPassword);
  // Hash outside the transaction (bcrypt is slow; don't hold the row locks open).
  const passwordHash = await hashPassword(password);
  // Consume the token and apply the change in one transaction: if anything
  // fails the single-use marking rolls back and the link can be retried.
  return prisma.$transaction(async (tx) => {
    const row = await consumeToken(token, "PASSWORD_RESET", tx);
    if (!row) return false;
    await tx.user.update({
      where: { id: row.userId },
      // A working reset link also proves control of the mailbox.
      data: { passwordHash, emailVerifiedAt: new Date() },
    });
    // Sign out everywhere.
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await audit(tx, { businessId: null, actor: { userId: row.userId }, scope: "user", action: "user.password_reset", entityType: "User", entityId: row.userId });
    return true;
  });
}

export async function updateDisplayName(userId: string, input: string) {
  const name = nameSchema.parse(input);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.name === name) return user;
  const updated = await prisma.user.update({ where: { id: userId }, data: { name } });
  await audit(prisma, { businessId: null, actor: { userId, email: user.email }, scope: "user", action: "user.profile_updated", entityType: "User", entityId: userId, metadata: { name: { from: user.name, to: name } } });
  return updated;
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new ValidationError("Current password is incorrect.", { currentPassword: "Incorrect password" });
  }
  const password = passwordSchema.parse(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.session.deleteMany({ where: { userId, NOT: keepSessionId ? { id: keepSessionId } : undefined } }),
  ]);
  await audit(prisma, { businessId: null, actor: { userId, email: user.email }, scope: "user", action: "user.password_changed", entityType: "User", entityId: userId });
}

// ---------------------------------------------------------------------------
// Invitations (acceptance side; creation lives in server/members.ts)
// ---------------------------------------------------------------------------

export async function findUsableInvitation(token: string) {
  const invite = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { business: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

/**
 * Accept an invitation for `userId`. The invitation email must match the
 * user's email, so a leaked link cannot be used by a different account.
 */
export async function acceptInvitation(token: string, userId: string) {
  const invite = await findUsableInvitation(token);
  if (!invite) throw new ValidationError("This invitation is invalid or has expired.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email !== invite.email) {
    throw new ValidationError(`This invitation was sent to ${invite.email}. Sign in with that account to accept it.`);
  }
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({
      where: { id: invite.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ValidationError("This invitation has already been used.");
    const existing = await tx.membership.findUnique({
      where: { userId_businessId: { userId, businessId: invite.businessId } },
    });
    if (!existing) {
      await tx.membership.create({ data: { userId, businessId: invite.businessId, role: invite.role } });
    }
    if (!user.emailVerifiedAt) {
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    }
    await audit(tx, {
      businessId: invite.businessId,
      actor: { userId, email: user.email },
      action: "invitation.accepted",
      entityType: "Invitation",
      entityId: invite.id,
      metadata: { role: invite.role, alreadyMember: Boolean(existing) },
    });
    return { businessId: invite.businessId };
  });
}

export async function listUserWorkspaces(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: { business: { select: { id: true, name: true, suspendedAt: true, subscription: true } } },
    orderBy: { business: { name: "asc" } },
  });
}
