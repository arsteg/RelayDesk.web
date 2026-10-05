import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";

/** Turn a service NotFoundError (including cross-tenant ids) into a 404 page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export function qs(base: string, params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `${base}?${str}` : base;
}
