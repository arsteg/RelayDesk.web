import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import type { ActionState } from "@/lib/action-state";

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string" && !k.startsWith("$") && !/password/i.test(k)) out[k] = v;
  }
  return out;
}

export function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * Runs a server action body and converts known errors into form state.
 * redirect()/notFound() are re-thrown so Next.js can handle them.
 */
export async function runAction(
  formData: FormData | null,
  fn: () => Promise<ActionState | void>,
): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    const values = formData ? formValues(formData) : undefined;
    if (err instanceof AppError) return { error: err.message, fieldErrors: err.fieldErrors, values };
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of err.issues) fieldErrors[i.path.join(".")] ??= i.message;
      return { error: "Please fix the highlighted fields.", fieldErrors, values };
    }
    console.error("[action] unexpected error", err);
    return { error: "Something went wrong. Please try again.", values };
  }
}
