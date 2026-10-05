import { ProductForm } from "@/components/products/product-form";
import { PageHeader } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { minorToInput } from "@/lib/money";
import { orNotFound } from "@/lib/page";
import { getProduct } from "@/server/products";
import { categoryOptions } from "@/server/categories";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantPage("products.manage");
  const product = await orNotFound(getProduct(ctx, (await params).id));
  return (
    <>
      <PageHeader title={`Edit ${product.name}`} back={{ href: "/app/products", label: "Products" }} />
      <ProductForm
        product={{ ...product, price: minorToInput(product.priceMinor, ctx.business.currency) }}
        categories={await categoryOptions(ctx)}
        currency={ctx.business.currency}
      />
    </>
  );
}
