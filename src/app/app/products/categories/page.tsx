import { ActionButton } from "@/components/forms";
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { listCategories } from "@/server/categories";
import { CategoryForm } from "@/components/products/category-form";
import { archiveCategoryAction } from "@/app/actions/business";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const ctx = await requireTenantPage("products.manage");
  const categories = await listCategories(ctx, { includeArchived: true });
  const readOnly = ctx.access.level !== "full";

  return (
    <>
      <PageHeader
        title="Categories"
        back={{ href: "/app/products", label: "Products" }}
        description="Group your products. Categories show up in the product form and the catalogue filter."
      />
      {readOnly ? <Alert tone="red">{ctx.access.reason}</Alert> : <div className="mb-6"><CategoryForm /></div>}
      {categories.length === 0 ? (
        <EmptyState title="No categories yet" description="Add categories like Cakes, Breads or Cookies to organise your catalogue." />
      ) : (
        <TableWrap>
          <thead><tr><Th>Name</Th><Th className="text-right">Products</Th><Th>Status</Th>{!readOnly && <Th />}</tr></thead>
          <tbody className="divide-y divide-stone-100">
            {categories.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-stone-900">{c.name}</Td>
                <Td className="text-right tabular-nums">{c.productCount}</Td>
                <Td>{c.archivedAt ? <Badge>Archived</Badge> : <Badge tone="green">Active</Badge>}</Td>
                {!readOnly && (
                  <Td className="text-right">
                    <span className="inline-flex gap-2">
                      {!c.archivedAt && <ButtonLink href={`/app/products/categories/${c.id}/edit`} variant="secondary" size="sm">Rename</ButtonLink>}
                      <ActionButton action={archiveCategoryAction} fields={{ id: c.id, archived: c.archivedAt ? "0" : "1" }}>{c.archivedAt ? "Restore" : "Archive"}</ActionButton>
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
