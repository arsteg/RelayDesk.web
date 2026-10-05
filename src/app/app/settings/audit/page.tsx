import { Pagination, Select, Button, TableWrap, Td, Th, EmptyState } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { qs, sp, type SearchParams } from "@/lib/page";
import { formatDateTime } from "@/lib/time";
import { listAuditLog } from "@/server/members";

export const metadata = { title: "Audit log" };

const GROUPS = ["order", "payment", "client", "product", "member", "invitation", "ownership", "settings", "subscription", "business", "data"];

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("audit.view");
  const params = await searchParams;
  const action = sp(params, "action");
  const page = Number(sp(params, "page") ?? 1) || 1;
  const { rows, total, pageSize } = await listAuditLog(ctx, { action, page });
  return (
    <>
      <form className="mb-4 flex gap-2">
        <Select name="action" defaultValue={action ?? ""} className="w-auto" aria-label="Filter">
          <option value="">All activity</option>
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </Select>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <>
          <TableWrap>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDateTime(r.createdAt, ctx.business.timezone)}</Td>
                  <Td>{r.actorEmail ?? (r.scope === "system" ? "System (billing)" : r.scope === "platform" ? "RelayDesk support" : "—")}</Td>
                  <Td><code className="text-xs">{r.action}</code></Td>
                  <Td className="max-w-md truncate text-xs text-stone-500" >{r.metadata ? JSON.stringify(r.metadata) : ""}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => qs("/app/settings/audit", { action, page: p })} />
        </>
      )}
    </>
  );
}
