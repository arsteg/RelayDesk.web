"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Field, Input, Textarea } from "@/components/ui";
import { createClientAction, updateClientAction } from "@/app/actions/business";

interface ClientValues { id?: string; name?: string; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null }

export function ClientForm({ client, next }: { client?: ClientValues; next?: string }) {
  const action = client?.id ? updateClientAction : createClientAction;
  return (
    <ActionForm action={action} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      {(s) => {
        const v = (k: keyof ClientValues) => s.values?.[k] ?? (client?.[k] as string | undefined) ?? "";
        const e = s.fieldErrors ?? {};
        return (
          <>
            {client?.id && <input type="hidden" name="id" value={client.id} />}
            {next && <input type="hidden" name="next" value={next} />}
            <Field label="Name" htmlFor="name" error={e.name} className="sm:col-span-2">
              <Input id="name" name="name" required defaultValue={v("name")} invalid={!!e.name} autoFocus />
            </Field>
            <Field label="Phone" htmlFor="phone" error={e.phone}>
              <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} invalid={!!e.phone} />
            </Field>
            <Field label="Email" htmlFor="email" error={e.email}>
              <Input id="email" name="email" type="email" defaultValue={v("email")} invalid={!!e.email} />
            </Field>
            <Field label="Address" htmlFor="address" error={e.address} className="sm:col-span-2">
              <Textarea id="address" name="address" rows={2} defaultValue={v("address")} />
            </Field>
            <Field label="Notes" htmlFor="notes" error={e.notes} className="sm:col-span-2" hint="Allergies, preferences, anniversaries…">
              <Textarea id="notes" name="notes" defaultValue={v("notes")} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <SubmitButton>{client?.id ? "Save changes" : "Create client"}</SubmitButton>
              <ButtonLink href={client?.id ? `/app/clients/${client.id}` : "/app/clients"} variant="ghost">Cancel</ButtonLink>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
