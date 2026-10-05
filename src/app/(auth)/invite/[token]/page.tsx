import Link from "next/link";
import { AcceptInviteForm, InviteRegisterForm } from "@/components/auth/forms";
import { Alert, Button } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { signupEnabled } from "@/lib/features";
import { findUsableInvitation } from "@/server/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: "Join a business" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findUsableInvitation(token);
  if (!invite) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Invitation unavailable</h1>
        <Alert tone="red">This invitation is invalid, was revoked, or has expired. Ask the business to send a new one.</Alert>
      </>
    );
  }
  const session = await getSession();
  const heading = (
    <>
      <h1 className="text-xl font-semibold">Join {invite.business.name}</h1>
      <p className="mb-6 mt-1 text-sm text-stone-500">
        You&apos;ve been invited as <strong>{ROLE_LABELS[invite.role]}</strong> ({invite.email}).
      </p>
    </>
  );
  if (session) {
    if (session.user.email !== invite.email) {
      return (
        <>
          {heading}
          <Alert tone="amber">
            You&apos;re signed in as {session.user.email}. Sign out and sign in as {invite.email} to accept.
          </Alert>
          <form action={logoutAction} className="mt-4">
            <Button type="submit" variant="secondary">Sign out</Button>
          </form>
        </>
      );
    }
    return (
      <>
        {heading}
        <AcceptInviteForm token={token} />
      </>
    );
  }
  const hasAccount = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  return (
    <>
      {heading}
      {hasAccount ? (
        <>
          <p className="mb-4 text-sm text-stone-600">You already have a RelayDesk account. Sign in to accept.</p>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="font-medium text-brand-700 hover:underline">Sign in to continue →</Link>
        </>
      ) : signupEnabled() ? (
        <InviteRegisterForm token={token} email={invite.email} />
      ) : (
        <Alert tone="amber">There is no RelayDesk account for {invite.email}, and new sign-ups are closed. Ask an administrator to create your account, then open this link again.</Alert>
      )}
    </>
  );
}
