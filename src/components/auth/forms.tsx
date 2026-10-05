"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";

/** Password field with a show/hide toggle button. */
function PasswordInput({ className, ...props }: ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={`pr-10 ${className ?? ""}`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-500 hover:text-stone-700"
      >
        {show ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
import {
  acceptInviteAction, changePasswordAction, confirmEmailAction, createWorkspaceAction, forgotPasswordAction,
  loginAction, registerAction, registerInvitedAction, resetPasswordAction, updateProfileAction,
} from "@/app/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      {(s) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email} />
          </Field>
          <Field label="Password" htmlFor="password">
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </Field>
          <div className="flex items-center justify-between">
            <Link href="/forgot-password" className="text-sm text-brand-700 hover:underline">Forgot password?</Link>
            <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function RegisterForm() {
  return (
    <ActionForm action={registerAction} className="space-y-4">
      {(s) => (
        <>
          <Field label="Your name" htmlFor="name" error={s.fieldErrors?.name}>
            <Input id="name" name="name" autoComplete="name" required defaultValue={s.values?.name} invalid={!!s.fieldErrors?.name} />
          </Field>
          <Field label="Business name" htmlFor="businessName" error={s.fieldErrors?.businessName}>
            <Input id="businessName" name="businessName" required defaultValue={s.values?.businessName} invalid={!!s.fieldErrors?.businessName} />
          </Field>
          <Field label="Email" htmlFor="email" error={s.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email} invalid={!!s.fieldErrors?.email} />
          </Field>
          <Field label="Password" htmlFor="password" error={s.fieldErrors?.password} hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required invalid={!!s.fieldErrors?.password} />
          </Field>
          <Field label="Confirm password" htmlFor="confirmPassword" error={s.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required invalid={!!s.fieldErrors?.confirmPassword} />
          </Field>
          <SubmitButton className="w-full" pendingText="Creating workspace…">Create account & start free trial</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ForgotPasswordForm() {
  return (
    <ActionForm action={forgotPasswordAction} className="space-y-4">
      {(s) =>
        s.ok ? null : (
          <>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={s.values?.email} />
            </Field>
            <SubmitButton className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
          </>
        )
      }
    </ActionForm>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} className="space-y-4">
      {(s) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="New password" htmlFor="password" error={s.fieldErrors?.password} hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword" error={s.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full">Set new password</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ConfirmEmailForm({ token }: { token: string }) {
  return (
    <ActionForm action={confirmEmailAction}>
      {() => (
        <>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full" pendingText="Confirming…">Confirm my email</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  return (
    <ActionForm action={acceptInviteAction}>
      {() => (
        <>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full" pendingText="Joining…">Accept invitation</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function InviteRegisterForm({ token, email }: { token: string; email: string }) {
  return (
    <ActionForm action={registerInvitedAction} className="space-y-4">
      {(s) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Field label="Email" htmlFor="email">
            <Input id="email" value={email} disabled readOnly />
          </Field>
          <Field label="Your name" htmlFor="name" error={s.fieldErrors?.name}>
            <Input id="name" name="name" autoComplete="name" required defaultValue={s.values?.name} />
          </Field>
          <Field label="Password" htmlFor="password" error={s.fieldErrors?.password} hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password" htmlFor="confirmPassword" error={s.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full" pendingText="Joining…">Create account & join</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ProfileForm({ name }: { name: string }) {
  return (
    <ActionForm action={updateProfileAction} className="space-y-4">
      {(s) => (
        <>
          <Field label="Display name" htmlFor="name" error={s.fieldErrors?.name} hint="Shown to your team and in the activity log.">
            <Input id="name" name="name" autoComplete="name" maxLength={120} required defaultValue={s.values?.name ?? name} />
          </Field>
          <SubmitButton>Save name</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4" resetOnSuccess>
      {(s) => (
        <>
          <Field label="Current password" htmlFor="currentPassword" error={s.fieldErrors?.currentPassword}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={s.fieldErrors?._form ?? s.fieldErrors?.newPassword} hint="At least 10 characters.">
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword" error={s.fieldErrors?.confirmPassword}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton>Change password</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CreateWorkspaceForm() {
  return (
    <ActionForm action={createWorkspaceAction} className="flex flex-col gap-3 sm:flex-row sm:items-start">
      {(s) => (
        <>
          <Field label="New business name" htmlFor="businessName" error={s.fieldErrors?.businessName ?? s.fieldErrors?._form} className="flex-1">
            <Input id="businessName" name="businessName" required defaultValue={s.values?.businessName} />
          </Field>
          <SubmitButton className="sm:mt-6" pendingText="Creating…">Create workspace</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
