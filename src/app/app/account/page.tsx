import { ChangePasswordForm, ProfileForm } from "@/components/auth/forms";
import { prisma } from "@/lib/db";
import { ActionButton } from "@/components/forms";
import { Card, DescriptionList, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions";
import { leaveWorkspaceAction, signOutOtherSessionsAction } from "@/app/actions/auth";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireTenantPage();
  const session = (await getSession())!;
  return (
    <>
      <PageHeader title="My account" back={{ href: "/app/settings", label: "Settings" }} />
      <div className="grid max-w-2xl gap-6">
        <Card title="Profile">
          <DescriptionList items={[
            { label: "Email", value: session.user.email },
            { label: "Role in this business", value: ROLE_LABELS[ctx.role] },
          ]} />
          <div className="mt-4 border-t border-stone-100 pt-4">
            <ProfileForm name={session.user.name} />
          </div>
        </Card>
        <Card title="Change password"><ChangePasswordForm /></Card>
        <Card title="Sessions">
          <p className="mb-3 text-sm text-stone-600">
            You are signed in on {await prisma.session.count({ where: { userId: session.userId, expiresAt: { gt: new Date() } } })} device(s) or browser(s), including this one.
          </p>
          <ActionButton action={signOutOtherSessionsAction} confirm="Sign out everywhere else?">Sign out other sessions</ActionButton>
        </Card>
        {ctx.role !== "OWNER" && (
          <Card title="Leave workspace">
            <p className="mb-3 text-sm text-stone-600">You will lose access to {ctx.business.name}. Its records are not affected.</p>
            <ActionButton action={leaveWorkspaceAction} variant="danger" confirm="Leave this workspace?">Leave {ctx.business.name}</ActionButton>
          </Card>
        )}
      </div>
    </>
  );
}
