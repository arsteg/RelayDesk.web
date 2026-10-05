"use client";

import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  changeRoleAction, checkoutAction, inviteAction, portalAction, removeLogoAction, simulateBillingAction, updateSettingsAction, uploadLogoAction,
} from "@/app/actions/admin";

export interface SettingsValues {
  name: string; phone: string; email: string; address: string; website: string; taxId: string;
  currency: string; timezone: string; defaultTaxRate: string; invoiceFooter: string; invoicePrefix: string;
}

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Colombo", "Asia/Dhaka", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "NPR", "LKR", "BDT", "JPY"];

export function SettingsForm({ initial, disabled }: { initial: SettingsValues; disabled?: boolean }) {
  return (
    <ActionForm action={updateSettingsAction} className="grid gap-4 sm:grid-cols-2">
      {(s) => {
        const v = (k: keyof SettingsValues) => s.values?.[k] ?? initial[k];
        const e = s.fieldErrors ?? {};
        return (
          <fieldset disabled={disabled} className="contents">
            <Field label="Business name" htmlFor="name" error={e.name} className="sm:col-span-2">
              <Input id="name" name="name" defaultValue={v("name")} required />
            </Field>
            <Field label="Phone" htmlFor="phone" error={e.phone}><Input id="phone" name="phone" defaultValue={v("phone")} /></Field>
            <Field label="Email" htmlFor="email" error={e.email}><Input id="email" name="email" type="email" defaultValue={v("email")} /></Field>
            <Field label="Address" htmlFor="address" error={e.address} className="sm:col-span-2"><Textarea id="address" name="address" rows={2} defaultValue={v("address")} /></Field>
            <Field label="Website" htmlFor="website" error={e.website}><Input id="website" name="website" defaultValue={v("website")} /></Field>
            <Field label="Tax ID (e.g. GSTIN)" htmlFor="taxId" error={e.taxId}><Input id="taxId" name="taxId" defaultValue={v("taxId")} /></Field>
            <Field label="Currency" htmlFor="currency" error={e.currency} hint="ISO 4217 code">
              <Input id="currency" name="currency" list="currencies" defaultValue={v("currency")} />
              <datalist id="currencies">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Timezone" htmlFor="timezone" error={e.timezone} hint="IANA name, used for dates and 'today'">
              <Input id="timezone" name="timezone" list="timezones" defaultValue={v("timezone")} />
              <datalist id="timezones">{TIMEZONES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Default tax %" htmlFor="defaultTaxRate" error={e.defaultTaxRate} hint="Pre-filled on new orders">
              <Input id="defaultTaxRate" name="defaultTaxRate" inputMode="decimal" defaultValue={v("defaultTaxRate")} />
            </Field>
            <Field label="Order number prefix" htmlFor="invoicePrefix" error={e.invoicePrefix} hint="e.g. ORD- gives ORD-0042">
              <Input id="invoicePrefix" name="invoicePrefix" defaultValue={v("invoicePrefix")} />
            </Field>
            <Field label="Invoice footer" htmlFor="invoiceFooter" error={e.invoiceFooter} className="sm:col-span-2" hint="Thank-you note, bank/UPI details, terms…">
              <Textarea id="invoiceFooter" name="invoiceFooter" defaultValue={v("invoiceFooter")} />
            </Field>
            {!disabled && <div className="sm:col-span-2"><SubmitButton>Save settings</SubmitButton></div>}
          </fieldset>
        );
      }}
    </ActionForm>
  );
}

export function LogoForm({ hasLogo, version }: { hasLogo: boolean; version: number }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl bg-stone-100 ring-1 ring-stone-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {hasLogo ? <img src={`/api/logo?v=${version}`} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-xs text-stone-400">No logo</span>}
      </div>
      <ActionForm action={uploadLogoAction} className="space-y-2">
        {() => (
          <>
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="block text-sm" aria-label="Logo file" />
            <p className="text-xs text-stone-500">PNG, JPEG or WebP, up to 512 KB.</p>
            <div className="flex gap-2">
              <SubmitButton size="sm" pendingText="Uploading…">Upload</SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
      {hasLogo && <ActionButton action={async () => removeLogoAction()}>Remove logo</ActionButton>}
    </div>
  );
}

export function InviteForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  return (
    <ActionForm action={inviteAction} className="flex flex-col gap-3 sm:flex-row sm:items-start" resetOnSuccess>
      {(s) => (
        <>
          <Field label="Email" htmlFor="invite-email" error={s.fieldErrors?.email} className="flex-1">
            <Input id="invite-email" name="email" type="email" required defaultValue={s.ok ? "" : s.values?.email} />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue={s.values?.role ?? "STAFF"}>
              <option value="STAFF">Staff</option>
              {canInviteAdmin && <option value="ADMIN">Admin</option>}
            </Select>
          </Field>
          <SubmitButton className="sm:mt-6" pendingText="Sending…">Send invite</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RoleSelect({ membershipId, role, options }: { membershipId: string; role: string; options: string[] }) {
  return (
    <ActionForm action={changeRoleAction} className="flex items-center gap-1">
      {(s) => (
        <>
          <input type="hidden" name="id" value={membershipId} />
          <Select name="role" defaultValue={role} aria-label="Role" className="w-auto py-1 text-xs">
            {options.map((o) => <option key={o} value={o}>{o[0] + o.slice(1).toLowerCase()}</option>)}
          </Select>
          <SubmitButton size="sm" variant="secondary" pendingText="…">Save</SubmitButton>
          {s.error && <span className="text-xs text-red-600">{s.error}</span>}
        </>
      )}
    </ActionForm>
  );
}

export function CheckoutButton({ plan, label }: { plan: string; label: string }) {
  return <ActionButton action={checkoutAction} fields={{ plan }} variant="primary" size="md">{label}</ActionButton>;
}

export function PortalButton() {
  return <ActionButton action={async () => portalAction()} variant="secondary" size="md">Manage billing in Stripe</ActionButton>;
}

export function SimulateButton({ action, label }: { action: string; label: string }) {
  return <ActionButton action={simulateBillingAction} fields={{ simulate: action }}>{label}</ActionButton>;
}
