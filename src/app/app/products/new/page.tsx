import { ProductForm } from "@/components/products/product-form";
import { Alert, PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { categoryOptions } from "@/server/categories";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requireTenantPage("products.manage");
  return (
    <>
      <PageHeader title="New product" back={{ href: "/app/products", label: "Products" }} />
      {ctx.access.level !== "full" ? <Alert tone="red">{ctx.access.reason}</Alert> : <ProductForm categories={await categoryOptions(ctx)} currency={ctx.business.currency} />}
    </>
  );
}
