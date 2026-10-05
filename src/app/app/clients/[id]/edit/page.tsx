import { ClientForm } from "@/components/clients/client-form";
import { PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page";
import { getClient } from "@/server/clients";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage("clients.manage");
  const client = await orNotFound(getClient(ctx, (await params).id));
  return (
    <>
      <PageHeader title={`Edit ${client.name}`} back={{ href: `/app/clients/${client.id}`, label: client.name }} />
      <ClientForm client={client} />
    </>
  );
}
