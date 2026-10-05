import { PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { orNotFound } from "@/lib/page";
import { getCategory } from "@/server/categories";
import { CategoryForm } from "@/components/products/category-form";

export const metadata = { title: "Rename category" };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage("products.manage");
  const category = await orNotFound(getCategory(ctx, (await params).id));
  return (
    <>
      <PageHeader title={`Rename ${category.name}`} back={{ href: "/app/products/categories", label: "Categories" }} />
      <CategoryForm category={{ id: category.id, name: category.name }} />
    </>
  );
}
