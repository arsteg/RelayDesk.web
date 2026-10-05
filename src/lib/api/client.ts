"use client";

/**
 * Browser API client for the FastAPI ordering backend.
 *
 * Calls go to the same-origin path `/api/py/*`, which next.config.ts rewrites to
 * the FastAPI service. Same-origin means the admin `bl_session` cookie flows
 * automatically and the production CSP (`connect-src 'self'`) is satisfied,
 * including for SSE. Customer requests pass a bearer token.
 */

import type { ApiErrorBody } from "@relaydesk/shared";

export const API_BASE = "/api/py";

export class ApiError extends Error {
  code: string;
  fields?: Record<string, string>;
  status: number;
  constructor(status: number, body: ApiErrorBody | { message?: string }) {
    const err = (body as ApiErrorBody).error;
    super(err?.message || (body as { message?: string }).message || "Request failed");
    this.status = status;
    this.code = err?.code || "error";
    this.fields = err?.fields;
  }
}

export interface FetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function apiFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    credentials: "include", // send the admin session cookie for admin routes
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data ?? {});
  return data as T;
}

/**
 * Subscribe to an order event stream (SSE) with automatic polling fallback.
 *
 * Returns a cleanup function. `onEvent` fires for each realtime event; if the
 * stream errors repeatedly, `onFallback` is invoked so the caller can start
 * polling the matching list endpoint with `updatedSince`.
 */
export function openOrderStream(opts: {
  path: string; // e.g. "/admin/realtime/stream" or "/customer/realtime/stream"
  token?: string | null;
  onEvent: (event: { type: string; order?: unknown }) => void;
  onStatus?: (status: "connected" | "fallback" | "reconnecting") => void;
}): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let failures = 0;

  const url = () => {
    const u = new URL(`${API_BASE}${opts.path}`, window.location.origin);
    if (opts.token) u.searchParams.set("token", opts.token);
    return u.toString();
  };

  const connect = () => {
    if (closed) return;
    es = new EventSource(url(), { withCredentials: true });
    es.onopen = () => {
      failures = 0;
      opts.onStatus?.("connected");
    };
    const handle = (e: MessageEvent) => {
      try {
        opts.onEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    // Named events plus the default message handler.
    es.addEventListener("order.created", handle as EventListener);
    es.addEventListener("order.updated", handle as EventListener);
    es.addEventListener("order.status_changed", handle as EventListener);
    es.onmessage = handle;
    es.onerror = () => {
      if (closed) return;
      failures += 1;
      if (failures >= 3) {
        // Give up on streaming and let the caller poll with updatedSince.
        es?.close();
        opts.onStatus?.("fallback");
      } else {
        // Let the browser auto-reconnect (honouring our `retry:` hint).
        opts.onStatus?.("reconnecting");
      }
    };
  };

  connect();
  return () => {
    closed = true;
    es?.close();
  };
}
