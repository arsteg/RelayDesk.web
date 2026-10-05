import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { getTenant } from "@/lib/auth/current";
import { billingEnabled } from "@/lib/features";
import { can } from "@/lib/permissions";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenant();
  const tabs = [
    { href: "/app/settings", label: "Business" },
    ...(billingEnabled() && can(ctx.role, "billing.manage") ? [{ href: "/app/settings/billing", label: "Billing" }] : []),
    ...(can(ctx.role, "data.export") ? [{ href: "/app/settings/export", label: "Data export" }] : []),
    ...(can(ctx.role, "audit.view") ? [{ href: "/app/settings/audit", label: "Audit log" }] : []),
    { href: "/app/account", label: "My account" },
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <nav className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-stone-200">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-stone-600 hover:border-stone-300 hover:text-stone-900">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
