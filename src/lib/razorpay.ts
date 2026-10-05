import "server-only";
import crypto from "node:crypto";
import { AppError } from "@/lib/errors";

/**
 * Platform Razorpay client for SaaS billing (suppliers paying RelayDesk).
 * Uses the PLATFORM's own keys from the environment — distinct from each
 * supplier's per-business keys used for end-customer order payments.
 */

const API = "https://api.razorpay.com/v1";

function keys() {
  return { id: process.env.RAZORPAY_KEY_ID ?? "", secret: process.env.RAZORPAY_KEY_SECRET ?? "" };
}

export function razorpayConfigured(): boolean {
  const k = keys();
  return !!(k.id && k.secret);
}

export async function razorpayRequest<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const k = keys();
  if (!k.id || !k.secret) throw new AppError("Razorpay is not configured.", "BILLING_UNAVAILABLE");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${k.id}:${k.secret}`).toString("base64"),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new AppError("Razorpay request failed.", "BILLING_UNAVAILABLE");
  return data;
}

/** Verify a Razorpay webhook signature (HMAC-SHA256 of the raw body). */
export function verifyRazorpayWebhook(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
