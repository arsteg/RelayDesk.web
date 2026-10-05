"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { runAction, str } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { clientIp, createSession, destroySession, getSession, setActiveBusiness } from "@/lib/auth/session";
import { LIMITS, enforceRateLimit, rateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { signupEnabled } from "@/lib/features";
import {
  acceptInvitation, authenticate, changePassword, createBusinessWithOwner, updateDisplayName, registerInvitedUser, registerOwner,
  requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail,
} from "@/server/auth";
import { loadTenantContext } from "@/server/context";
import { leaveBusiness } from "@/server/members";
import { requireUser, requireVerifiedUser, getTenant } from "@/lib/auth/current";

const SIGNUPS_CLOSED = "New sign-ups are closed. Ask an administrator to create your account.";

/** Only allow same-site relative redirects. */
function safeNext(next: string | null | undefined, fallback = "/app") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const email = str(formData, "email").trim().toLowerCase();
    const ip = await clientIp();
    await enforceRateLimit(`login:ip:${ip}`, ...LIMITS.loginPerIp);
    await enforceRateLimit(`login:email-ip:${email}:${ip}`, ...LIMITS.loginPerEmailIp);
    await enforceRateLimit(`login:email:${email}`, ...LIMITS.loginPerEmail);
    const user = await authenticate(email, str(formData, "password"));
    if (!user) throw new ValidationError("Incorrect email or password.");
    await audit(prisma, { businessId: null, actor: { userId: user.id, email: user.email }, scope: "user", action: "user.login", entityType: "User", entityId: user.id, metadata: { ip } });
    const first = await prisma.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    await createSession(user.id, first?.businessId);
    redirect(safeNext(str(formData, "next"), "/app"));
  });
}

export async function registerAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    if (!signupEnabled()) throw new ValidationError(SIGNUPS_CLOSED);
    await enforceRateLimit(`register:ip:${await clientIp()}`, ...LIMITS.registerPerIp);
    if (str(formData, "password") !== str(formData, "confirmPassword")) {
      throw new ValidationError("Passwords do not match.", { confirmPassword: "Passwords do not match" });
    }
    const { user, businessId } = await registerOwner({
      name: str(formData, "name"),
      email: str(formData, "email"),
      password: str(formData, "password"),
      businessName: str(formData, "businessName"),
    });
    await createSession(user.id, businessId);
    redirect("/verify-email");
  });
}

export async function registerInvitedAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    if (!signupEnabled()) throw new ValidationError(SIGNUPS_CLOSED);
    await enforceRateLimit(`invite-accept:ip:${await clientIp()}`, ...LIMITS.inviteAcceptPerIp);
    if (str(formData, "password") !== str(formData, "confirmPassword")) {
      throw new ValidationError("Passwords do not match.", { confirmPassword: "Passwords do not match" });
    }
    const { user, businessId } = await registerInvitedUser({
      name: str(formData, "name"),
      password: str(formData, "password"),
      inviteToken: str(formData, "token"),
    });
    await createSession(user.id, businessId);
    redirect("/app");
  });
}

export async function acceptInviteAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    await enforceRateLimit(`invite-accept:ip:${await clientIp()}`, ...LIMITS.inviteAcceptPerIp);
    const session = await getSession();
    if (!session) redirect("/login");
    const { businessId } = await acceptInvitation(str(formData, "token"), session.userId);
    await setActiveBusiness(session.id, businessId);
    revalidatePath("/", "layout");
    redirect("/app");
  });
}

export async function logoutAction() {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function resendVerificationAction(): Promise<ActionState> {
  return runAction(null, async () => {
    const user = await requireUser();
    await enforceRateLimit(`verify-resend:${user.id}`, ...LIMITS.verifyResendPerUser);
    if (!(await sendVerificationEmail(user.id))) {
      throw new ValidationError("We couldn't send the email right now. Please try again in a few minutes.");
    }
    return { ok: true, message: "We sent a new verification link. Check your inbox." };
  });
}

export async function confirmEmailAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ok = await verifyEmail(str(formData, "token"));
    if (!ok) throw new ValidationError("This verification link is invalid or has expired. Sign in to request a new one.");
    const session = await getSession();
    redirect(session ? "/app" : "/login?verified=1");
  });
}

export async function forgotPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const email = str(formData, "email").trim().toLowerCase();
    await enforceRateLimit(`reset:ip:${await clientIp()}`, ...LIMITS.passwordResetPerIp);
    // Per-email limit fails silently so it cannot be used to probe accounts.
    const perEmail = await rateLimit(`reset:email:${email}`, ...LIMITS.passwordResetPerEmail);
    if (perEmail.allowed) await requestPasswordReset(email);
    return { ok: true, message: "If an account exists for that email, we've sent a reset link." };
  });
}

export async function resetPasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    await enforceRateLimit(`reset-confirm:ip:${await clientIp()}`, ...LIMITS.passwordResetPerIp);
    if (str(formData, "password") !== str(formData, "confirmPassword")) {
      throw new ValidationError("Passwords do not match.", { confirmPassword: "Passwords do not match" });
    }
    const ok = await resetPassword(str(formData, "token"), str(formData, "password"));
    if (!ok) throw new ValidationError("This reset link is invalid or has expired. Request a new one.");
    redirect("/login?reset=1");
  });
}

export async function updateProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await getSession();
    if (!session) redirect("/login");
    try {
      await updateDisplayName(session.userId, str(formData, "name"));
    } catch (err) {
      if (err instanceof ZodError) throw new ValidationError("Please fix the highlighted fields.", { name: err.issues[0]?.message ?? "Invalid name" });
      throw err;
    }
    // The name appears in the app layout (sidebar), so refresh every page.
    revalidatePath("/", "layout");
    return { ok: true, message: "Display name updated." };
  });
}

export async function changePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await getSession();
    if (!session) redirect("/login");
    await enforceRateLimit(`change-password:${session.userId}`, ...LIMITS.changePasswordPerUser);
    if (str(formData, "newPassword") !== str(formData, "confirmPassword")) {
      throw new ValidationError("Passwords do not match.", { confirmPassword: "Passwords do not match" });
    }
    await changePassword(session.userId, str(formData, "currentPassword"), str(formData, "newPassword"), session.id);
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  });
}

/** Switch workspace: only to a business the user is a member of. */
export async function switchBusinessAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const businessId = str(formData, "businessId");
  const ctx = await loadTenantContext(session.userId, businessId);
  if (ctx) await setActiveBusiness(session.id, ctx.businessId);
  // The URL stays /app while the tenant changes, so drop all cached RSC payloads.
  revalidatePath("/", "layout");
  redirect(ctx ? "/app" : "/workspaces");
}

export async function createWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    if (!signupEnabled()) throw new ValidationError("New businesses can't be created while sign-ups are closed.");
    const user = await requireVerifiedUser();
    const session = (await getSession())!;
    await enforceRateLimit(`create-workspace:${user.id}`, ...LIMITS.createWorkspacePerUser);
    const owned = await prisma.membership.count({ where: { userId: user.id, role: "OWNER" } });
    if (owned >= 10) throw new ValidationError("You can own at most 10 workspaces.");
    const { businessId } = await createBusinessWithOwner(user.id, str(formData, "businessName"));
    await setActiveBusiness(session.id, businessId);
    revalidatePath("/", "layout");
    redirect("/app");
  });
}

export async function leaveWorkspaceAction(): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getTenant();
    await leaveBusiness(ctx);
    const session = (await getSession())!;
    await setActiveBusiness(session.id, null);
    revalidatePath("/", "layout");
    redirect("/workspaces");
  });
}

export async function signOutOtherSessionsAction(): Promise<ActionState> {
  return runAction(null, async () => {
    const session = await getSession();
    if (!session) redirect("/login");
    const { count } = await prisma.session.deleteMany({ where: { userId: session.userId, NOT: { id: session.id } } });
    revalidatePath("/app/account");
    await audit(prisma, { businessId: null, actor: { userId: session.userId, email: session.user.email }, scope: "user", action: "user.sessions_revoked", entityType: "User", entityId: session.userId, metadata: { count } });
    return { ok: true, message: count ? `Signed out ${count} other session${count === 1 ? "" : "s"}.` : "No other active sessions." };
  });
}
