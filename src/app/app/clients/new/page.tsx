import { ClientForm } from "@/components/clients/client-form";
import { Alert, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { sp, type SearchParams } from "@/lib/page";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("clients.manage");
  const next = sp(await searchParams, "next");
  return (
    <>
      <PageHeader title="New client" back={{ href: "/app/clients", label: "Clients" }} />
      {ctx.access.level !== "full" ? <Alert tone="red">{ctx.access.reason}</Alert> : <ClientForm next={next} />}
    </>
  );
}
