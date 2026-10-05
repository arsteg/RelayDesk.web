"use client";

import { useActionState } from "react";
import { resendVerificationAction } from "@/app/actions/auth";
import { SubmitButton } from "@/components/forms";

export function ResendVerification() {
  const [state, action] = useActionState(async () => resendVerificationAction(), {});
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary" pendingText="Sending…">Resend email</SubmitButton>
      {state.message && <p className="text-xs text-emerald-700">{state.message}</p>}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
