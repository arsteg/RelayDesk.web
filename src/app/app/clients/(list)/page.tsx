import Link from "next/link";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Pagination, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { qs, sp, type SearchParams } from "@/lib/page";
import { listClients } from "@/server/clients";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("clients.manage");
  const params = await searchParams;
  const q = sp(params, "q");
  const archived = sp(params, "archived") === "1";
  const page = Number(sp(params, "page") ?? 1) || 1;
  const { rows, total, pageSize } = await listClients(ctx, { q, includeArchived: archived, page });
  const writable = ctx.access.level === "full";

  return (
    <>
      <PageHeader title="Clients" description={`${total} ${archived ? "" : "active "}clients`} actions={writable && <ButtonLink href="/app/clients/new">New client</ButtonLink>} />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name, phone or email" className="max-w-xs" aria-label="Search clients" />
        <label className="flex items-center gap-1.5 text-sm text-stone-600">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} className="rounded border-stone-300" /> Include archived
        </label>
        <Button type="submit" variant="secondary">Search</Button>
        {(q || archived) && <Link href="/app/clients" className="text-sm text-stone-500 hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={q ? "No clients match your search" : "No clients yet"}
          description={q ? "Try a different name or phone number." : "Add the people and businesses you bake for."}
          action={writable && !q ? <ButtonLink href="/app/clients/new">Add a client</ButtonLink> : undefined}
        />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr><Th>Name</Th><Th>Phone</Th><Th className="hidden md:table-cell">Email</Th><Th className="text-right">Orders</Th><Th className="text-right">Outstanding</Th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <Td>
                    <Link href={`/app/clients/${c.id}`} className="font-medium text-stone-900 hover:text-brand-700">{c.name}</Link>{" "}
                    {c.archivedAt && <Badge>Archived</Badge>}
                  </Td>
                  <Td>{c.phone ?? "—"}</Td>
                  <Td className="hidden md:table-cell">{c.email ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{c.orderCount}</Td>
                  <Td className={`text-right tabular-nums ${c.outstandingMinor > 0 ? "text-red-700" : ""}`}>{formatMoney(c.outstandingMinor, ctx.business.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => qs("/app/clients", { q, archived: archived ? "1" : undefined, page: p })} />
        </>
      )}
    </>
  );
}
