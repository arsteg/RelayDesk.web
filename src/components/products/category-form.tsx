"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Field, Input } from "@/components/ui";
import { createCategoryAction, updateCategoryAction } from "@/app/actions/business";

export function CategoryForm({ category }: { category?: { id: string; name: string } }) {
  const action = category ? updateCategoryAction : createCategoryAction;
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2" resetOnSuccess={!category}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        return (
          <>
            {category && <input type="hidden" name="id" value={category.id} />}
            <Field label="Category name" htmlFor="name" error={e.name} className="min-w-64">
              <Input id="name" name="name" required defaultValue={s.values?.name ?? category?.name ?? ""} invalid={!!e.name} placeholder="e.g. Cakes" />
            </Field>
            <SubmitButton>{category ? "Save" : "Add category"}</SubmitButton>
            {category && <ButtonLink href="/app/products/categories" variant="ghost">Cancel</ButtonLink>}
          </>
        );
      }}
    </ActionForm>
  );
}
