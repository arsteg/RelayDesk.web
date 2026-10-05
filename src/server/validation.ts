import { z } from "zod";
import { ValidationError } from "@/lib/errors";

/** Optional trimmed text: empty strings become null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address");

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[+()\d\s-]{6,20}$/.test(v), "Enter a valid phone number");

/** Parse with zod and convert failures into a ValidationError with per-field messages. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new ValidationError("Please fix the highlighted fields.", fieldErrors);
}
