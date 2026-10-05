import { NextResponse, type NextRequest } from "next/server";
import { SESSION_TTL_DAYS, sessionCookieName, sessionCookieOptions } from "@/lib/auth/cookie";

const PROTECTED = ["/app", "/workspaces", "/invoice", "/suspended", "/verify-email"];

/**
 * Optimistic gate only: bounces requests without a session cookie to /login
 * and keeps the cookie's expiry sliding. Real authentication, role and
 * tenant checks happen on the server in every page, action and route handler.
 */
export function proxy(request: NextRequest) {
  const name = sessionCookieName();
  const token = request.cookies.get(name)?.value;
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && pathname !== "/verify-email/confirm";

  if (!token) {
    if (!isProtected) return NextResponse.next();
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Refresh at most once a day (tracked by a tiny marker cookie) so the
  // browser cookie lives as long as the DB session it points to.
  if (isProtected && !request.cookies.get("bl_seen")) {
    res.cookies.set(name, token, sessionCookieOptions(new Date(Date.now() + SESSION_TTL_DAYS * 86400_000)));
    res.cookies.set("bl_seen", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 86400, secure: process.env.NODE_ENV === "production" });
  }
  return res;
}

export const config = {
  matcher: ["/app/:path*", "/workspaces/:path*", "/invoice/:path*", "/suspended", "/verify-email"],
};
