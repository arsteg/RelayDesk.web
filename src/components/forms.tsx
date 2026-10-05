"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action-state";
import { Alert, Button, type ButtonVariant } from "@/components/ui";

export function SubmitButton({ children, variant = "primary", size = "md", pendingText, className }: { children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} className={className}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form bound to a server action via useActionState. Children receive the
 * current state so fields can show errors and keep submitted values.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess,
}: {
  action: Action;
  children: (state: ActionState) => ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate>
      {state.error && <Alert tone="red" className="mb-4">{state.error}</Alert>}
      {state.ok && (state.message || successMessage) && <Alert tone="green" className="mb-4">{state.message ?? successMessage}</Alert>}
      {children(state)}
    </form>
  );
}

/** Small inline form button for one-off actions (archive, revoke...). Optional confirm step. */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
}: {
  action: Action;
  fields?: Record<string, string>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [armed, setArmed] = useState(false);
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      {fields && Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm && !armed ? (
        <Button type="button" variant={variant} size={size} onClick={() => setArmed(true)}>
          {children}
        </Button>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {confirm && <span className="text-xs text-stone-600">{confirm}</span>}
          <SubmitButton variant={confirm ? "danger" : variant} size={size} pendingText="Working…">
            {confirm ? "Confirm" : children}
          </SubmitButton>
          {confirm && (
            <Button type="button" variant="ghost" size={size} onClick={() => setArmed(false)}>
              Cancel
            </Button>
          )}
        </span>
      )}
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error}</span>}
    </form>
  );
}
