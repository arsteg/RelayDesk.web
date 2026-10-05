import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, ButtonLink } from "@/components/ui";
import { getTenant } from "@/lib/auth/current";

export const metadata = { title: "Workspace suspended" };

export default async function SuspendedPage() {
  const ctx = await getTenant();
  if (ctx.access.level !== "suspended") redirect("/app");
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="mb-4 text-2xl font-semibold">{ctx.business.name} is suspended</h1>
      <Alert tone="red">{ctx.access.reason}</Alert>
      {ctx.role === "OWNER" && (
        <div className="mt-6">
          <p className="mb-3 text-sm text-stone-600">Download your data:</p>
          <div className="flex flex-wrap gap-2">
            {(["clients", "orders", "payments"] as const).map((k) => (
              <a key={k} href={`/api/export/${k}`} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-stone-300 hover:bg-stone-50">{k}.csv</a>
            ))}
          </div>
        </div>
      )}
      <p className="mt-8 text-sm"><Link href="/workspaces" className="text-brand-700 hover:underline">Switch workspace</Link></p>
      <ButtonLink href="mailto:support@relaydesk.local" variant="secondary" className="mt-4">Contact support</ButtonLink>
    </main>
  );
}
