import Link from "next/link";
import { redirect } from "next/navigation";
import { SideNav, type NavItem } from "@/components/nav";
import { Alert, Button } from "@/components/ui";
import { getTenant } from "@/lib/auth/current";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { listUserWorkspaces } from "@/server/auth";
import { logoutAction, switchBusinessAction } from "@/app/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenant();
  if (ctx.access.level === "suspended") redirect("/suspended");
  const session = (await getSession())!;
  const workspaces = await listUserWorkspaces(ctx.userId);

  const items: NavItem[] = [
    { href: "/app", label: "Dashboard" },
    { href: "/app/live-orders", label: "Live orders" },
    { href: "/app/orders", label: "Orders" },
    ...(can(ctx.role, "prep.record") ? [{ href: "/app/preparation", label: "Preparation" }] : []),
    { href: "/app/clients", label: "Clients" },
    ...(can(ctx.role, "members.manage") ? [{ href: "/app/customers", label: "Customers" }] : []),
    { href: "/app/payments", label: "Payments" },
    ...(can(ctx.role, "payments.record") ? [{ href: "/app/reconciliation", label: "Reconciliation" }] : []),
    { href: "/app/products", label: "Products" },
    ...(can(ctx.role, "members.view") ? [{ href: "/app/team", label: "Team" }] : []),
    { href: "/app/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 lg:h-dvh lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:py-5">
        <Link href="/app" className="flex min-w-0 items-center gap-2 font-semibold">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">B</span>
          <span className="truncate">{ctx.business.name}</span>
        </Link>
        <div className="flex items-center gap-2 lg:mt-6 lg:flex-1 lg:flex-col lg:items-stretch">
          <SideNav
            items={items}
            footer={
              <div className="flex flex-wrap gap-x-4 gap-y-2 px-3 text-sm text-stone-600">
                {workspaces.length > 1 && <Link href="/workspaces">Switch workspace</Link>}
                <Link href="/app/account">Account</Link>
              </div>
            }
          />
          <div className="hidden lg:mt-auto lg:block lg:space-y-3 lg:border-t lg:border-stone-100 lg:pt-4">
            {workspaces.length > 1 && (
              <form action={switchBusinessAction} className="space-y-1">
                <label htmlFor="ws" className="text-xs font-medium text-stone-500">Workspace</label>
                <div className="flex gap-1">
                  <select id="ws" name="businessId" defaultValue={ctx.businessId} className="min-w-0 flex-1 rounded-lg border-0 py-1.5 text-sm ring-1 ring-stone-300">
                    {workspaces.map((w) => <option key={w.businessId} value={w.businessId}>{w.business.name}</option>)}
                  </select>
                  <Button size="sm" variant="secondary" type="submit">Go</Button>
                </div>
              </form>
            )}
            <div className="text-xs text-stone-500">
              <p className="truncate font-medium text-stone-700">{session.user.name}</p>
              <p className="truncate">{session.user.email} · {ROLE_LABELS[ctx.role]}</p>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <Link href="/workspaces" className="text-stone-600 hover:text-stone-900">All workspaces</Link>
              <Link href="/app/account" className="text-stone-600 hover:text-stone-900">Account</Link>
              <form action={logoutAction}><button type="submit" className="text-stone-600 hover:text-stone-900">Sign out</button></form>
            </div>
          </div>
          <form action={logoutAction} className="lg:hidden"><Button size="sm" variant="ghost" type="submit">Sign out</Button></form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        {ctx.access.level === "readonly" && (
          <Alert tone="red" className="mb-4" title="Read-only mode">
            {ctx.access.reason}{" "}
            {ctx.role === "OWNER" ? <Link href="/app/settings/billing" className="font-medium underline">Go to billing</Link> : "Ask the owner to update billing."}
          </Alert>
        )}
        {ctx.access.warning && (
          <Alert tone="amber" className="mb-4">
            {ctx.access.warning}{" "}
            {ctx.role === "OWNER" && <Link href="/app/settings/billing" className="font-medium underline">Manage billing</Link>}
          </Alert>
        )}
        {children}
      </main>
    </div>
  );
}
