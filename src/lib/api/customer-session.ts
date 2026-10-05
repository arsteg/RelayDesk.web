"use client";

/**
 * Customer auth/session state kept in localStorage for the web ordering portal.
 * The customer obtains a bearer token via onboarding or login; the business id and
 * currency are cached so the login screen and money formatting work without a
 * round-trip.
 */

import type { CustomerAuthResponse } from "@relaydesk/shared";

export const SESSION_KEY = "relaydesk.customer.session";

export interface CustomerSession {
  token: string;
  customer: CustomerAuthResponse["customer"];
  business: CustomerAuthResponse["business"];
}

export function parseSession(raw: string | null): CustomerSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CustomerSession;
  } catch {
    return null;
  }
}

export function saveSession(data: CustomerAuthResponse): CustomerSession {
  const session: CustomerSession = { token: data.token, customer: data.customer, business: data.business };
  if (typeof window !== "undefined") localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getSession(): CustomerSession | null {
  if (typeof window === "undefined") return null;
  return parseSession(localStorage.getItem(SESSION_KEY));
}

export function clearSession() {
  if (typeof window !== "undefined") localStorage.removeItem(SESSION_KEY);
}

/** Remembered business id so a returning customer can log in without a link. */
export function lastBusinessId(): string | null {
  return getSession()?.business.id ?? (typeof window !== "undefined" ? localStorage.getItem("relaydesk.customer.businessId") : null);
}

export function rememberBusinessId(businessId: string) {
  if (typeof window !== "undefined") localStorage.setItem("relaydesk.customer.businessId", businessId);
}
