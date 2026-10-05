"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Field, Input, Select, Textarea } from "@/components/ui";
import { createProductAction, updateProductAction } from "@/app/actions/business";

interface ProductValues {
  id?: string;
  name?: string;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  description?: string | null;
  unit?: string;
  price?: string;
  isAvailable?: boolean;
  isVariableMeasure?: boolean;
  orderUnits?: string[];
  estConversionPerOrderUnit?: number | null;
}

export function ProductForm({ product, categories, currency }: { product?: ProductValues; categories: { id: string; name: string }[]; currency: string }) {
  const action = product?.id ? updateProductAction : createProductAction;
  // Keep the product's current category selectable even if it was archived.
  const options =
    product?.categoryId && product.category && !categories.some((c) => c.id === product.categoryId)
      ? [{ id: product.categoryId, name: `${product.category.name} (archived)` }, ...categories]
      : categories;
  return (
    <ActionForm action={action} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {(s) => {
        const v = (k: keyof ProductValues) => s.values?.[k] ?? (product?.[k] as string | undefined) ?? "";
        const e = s.fieldErrors ?? {};
        return (
          <>
            {product?.id && <input type="hidden" name="id" value={product.id} />}
            <Field label="Name" htmlFor="name" error={e.name} className="sm:col-span-2">
              <Input id="name" name="name" required defaultValue={v("name")} invalid={!!e.name} />
            </Field>
            <Field label="Category" htmlFor="categoryId" error={e.categoryId} hint={<a href="/app/products/categories" className="underline hover:text-stone-700">Manage categories</a>}>
              <Select id="categoryId" name="categoryId" defaultValue={v("categoryId")} invalid={!!e.categoryId}>
                <option value="">No category</option>
                {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Unit" htmlFor="unit" error={e.unit} hint="piece, kg, dozen, box…">
              <Input id="unit" name="unit" required defaultValue={v("unit") || "piece"} invalid={!!e.unit} />
            </Field>
            <Field label={`Price per unit (${currency})`} htmlFor="price" error={e.price}>
              <Input id="price" name="price" inputMode="decimal" required defaultValue={v("price")} invalid={!!e.price} placeholder="0.00" />
            </Field>
            <Field label="Availability" htmlFor="isAvailable">
              <label className="flex items-center gap-2 py-2 text-sm">
                <input id="isAvailable" name="isAvailable" type="checkbox" defaultChecked={s.values ? s.values.isAvailable === "on" : (product?.isAvailable ?? true)} className="rounded border-stone-300" />
                Available for new orders
              </label>
            </Field>
            <Field label="Also orderable in (units)" htmlFor="orderUnits" error={e.orderUnits} hint="Comma-separated, e.g. box, case. The pricing unit above is always allowed.">
              <Input id="orderUnits" name="orderUnits" defaultValue={(product?.orderUnits ?? []).filter((u) => u !== (product?.unit ?? "")).join(", ")} invalid={!!e.orderUnits} />
            </Field>
            <Field label="Est. pricing-units per order-unit" htmlFor="estConversion" error={e.estConversion} hint="Optional, for planning when an order unit differs from the pricing unit.">
              <Input id="estConversion" name="estConversion" inputMode="numeric" defaultValue={product?.estConversionPerOrderUnit ?? ""} invalid={!!e.estConversion} />
            </Field>
            <Field label="Variable measure" htmlFor="isVariableMeasure" className="sm:col-span-2">
              <label className="flex items-center gap-2 py-2 text-sm">
                <input id="isVariableMeasure" name="isVariableMeasure" type="checkbox" defaultChecked={s.values ? s.values.isVariableMeasure === "on" : (product?.isVariableMeasure ?? false)} className="rounded border-stone-300" />
                Billed quantity is weighed/measured during preparation (catch-weight)
              </label>
            </Field>
            <Field label="Description" htmlFor="description" error={e.description} className="sm:col-span-2">
              <Textarea id="description" name="description" defaultValue={v("description")} />
            </Field>
            <p className="text-xs text-stone-500 sm:col-span-2">Price changes only affect new orders. Existing orders keep the description and price they were sold at.</p>
            <div className="flex gap-2 sm:col-span-2">
              <SubmitButton>{product?.id ? "Save product" : "Create product"}</SubmitButton>
              <ButtonLink href="/app/products" variant="ghost">Cancel</ButtonLink>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
