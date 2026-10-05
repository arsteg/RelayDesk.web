import Link from "next/link";
import { ActionButton } from "@/components/forms";
import { Badge, Button, ButtonLink, EmptyState, Input, PageHeader, Select, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/page";
import { listProducts } from "@/server/products";
import { categoryOptions } from "@/server/categories";
import { archiveProductAction } from "@/app/actions/business";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("products.view");
  const params = await searchParams;
  const q = sp(params, "q");
  const categoryId = sp(params, "category");
  const archived = sp(params, "archived") === "1";
  const [products, categories] = await Promise.all([listProducts(ctx, { q, categoryId, includeArchived: archived }), categoryOptions(ctx)]);
  const manage = can(ctx.role, "products.manage") && ctx.access.level === "full";

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue. Custom items can also be added directly on an order."
        actions={manage && (
          <span className="inline-flex gap-2">
            <ButtonLink href="/app/products/categories" variant="secondary">Categories</ButtonLink>
            <ButtonLink href="/app/products/new">New product</ButtonLink>
          </span>
        )}
      />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search products" className="max-w-xs" aria-label="Search products" />
        <Select name="category" defaultValue={categoryId ?? ""} className="w-auto" aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-stone-600">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} className="rounded border-stone-300" /> Include archived
        </label>
        <Button type="submit" variant="secondary">Filter</Button>
        {(q || categoryId || archived) && <Link href="/app/products" className="text-sm text-stone-500 hover:underline">Clear</Link>}
      </form>
      {products.length === 0 ? (
        <EmptyState title="No products found" description="Add cakes, breads and other items you sell regularly." action={manage ? <ButtonLink href="/app/products/new">Add a product</ButtonLink> : undefined} />
      ) : (
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th className="text-right">Price</Th><Th>Status</Th>{manage && <Th />}</tr></thead>
          <tbody className="divide-y divide-stone-100">
            {products.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-normal">
                  <p className="font-medium text-stone-900">{p.name}</p>
                  {p.description && <p className="max-w-md truncate text-xs text-stone-500">{p.description}</p>}
                </Td>
                <Td>{p.category?.name ?? "—"}</Td>
                <Td>{p.unit}</Td>
                <Td className="text-right tabular-nums">{formatMoney(p.priceMinor, ctx.business.currency)}</Td>
                <Td>{p.archivedAt ? <Badge>Archived</Badge> : p.isAvailable ? <Badge tone="green">Available</Badge> : <Badge tone="amber">Unavailable</Badge>}</Td>
                {manage && (
                  <Td className="text-right">
                    <span className="inline-flex gap-2">
                      {!p.archivedAt && <ButtonLink href={`/app/products/${p.id}/edit`} variant="secondary" size="sm">Edit</ButtonLink>}
                      <ActionButton action={archiveProductAction} fields={{ id: p.id, archived: p.archivedAt ? "0" : "1" }}>{p.archivedAt ? "Restore" : "Archive"}</ActionButton>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
