import { CreateWorkspaceForm } from "@/components/auth/forms";
import { Badge, Button, Card } from "@/components/ui";
import { requireVerifiedUser } from "@/lib/auth/current";
import { getSession } from "@/lib/auth/session";
import { billingEnabled, signupEnabled } from "@/lib/features";
import { ROLE_LABELS } from "@/lib/permissions";
import { SUBSCRIPTION_STATUS } from "@/lib/labels";
import { listUserWorkspaces } from "@/server/auth";
import { logoutAction, switchBusinessAction } from "@/app/actions/auth";

export const metadata = { title: "Workspaces" };

export default async function WorkspacesPage() {
  const user = await requireVerifiedUser();
  const session = await getSession();
  const workspaces = await listUserWorkspaces(user.id);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your workspaces</h1>
        <form action={logoutAction}><Button variant="ghost" type="submit">Sign out</Button></form>
      </div>
      {workspaces.length === 0 ? (
        <p className="mb-6 text-sm text-stone-600">You&apos;re not a member of any business yet. {signupEnabled() ? "Create one below or ask a business owner to invite you." : "Ask a business owner to invite you."}</p>
      ) : (
        <ul className="mb-8 space-y-2">
          {workspaces.map((m) => (
            <li key={m.id}>
              <form action={switchBusinessAction}>
                <input type="hidden" name="businessId" value={m.businessId} />
                <button type="submit" className="flex w-full items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-xs ring-1 ring-stone-200 hover:ring-brand-400">
                  <span>
                    <span className="block font-medium">{m.business.name}</span>
                    <span className="text-xs text-stone-500">{ROLE_LABELS[m.role]}{session?.activeBusinessId === m.businessId ? " · current" : ""}</span>
                  </span>
                  <span className="flex gap-2">
                    {m.business.suspendedAt && <Badge tone="red">Suspended</Badge>}
                    {billingEnabled() && m.business.subscription && <Badge tone={SUBSCRIPTION_STATUS[m.business.subscription.status].tone}>{SUBSCRIPTION_STATUS[m.business.subscription.status].label}</Badge>}
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {signupEnabled() && (
        <Card title="Start another business">
          <CreateWorkspaceForm />
        </Card>
      )}
    </main>
  );
}
