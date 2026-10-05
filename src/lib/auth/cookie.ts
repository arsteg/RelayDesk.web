/**
 * Session cookie naming, shared by the proxy and the session module (edge-safe:
 * no Node-only imports). In production the `__Host-` prefix makes browsers
 * insist on Secure, Path=/ and no Domain attribute, so the cookie cannot be
 * set or shadowed by a sibling subdomain.
 */
export const SESSION_TTL_DAYS = 30;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-bl_session" : "bl_session";
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}
