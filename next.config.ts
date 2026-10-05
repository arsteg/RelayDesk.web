import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content Security Policy. No third-party scripts, styles, frames or fonts
 * are used. Next.js needs inline scripts for hydration ('unsafe-inline'; a
 * nonce-based policy would force every page to be dynamic) and eval in dev.
 * Stripe Checkout / Portal are reached by top-level redirects, allowed in
 * form-action because Chrome applies it to redirects after a form POST.
 */
// Razorpay Checkout loads its script + modal iframe and calls the Razorpay API.
const RZP = "https://checkout.razorpay.com https://api.razorpay.com";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.razorpay.com",
  "font-src 'self' data:",
  `connect-src 'self' https://*.razorpay.com${isProd ? "" : " ws: wss:"}`,
  `frame-src ${RZP}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  `form-action 'self' https://checkout.stripe.com https://billing.stripe.com ${RZP}`,
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// Extra origins allowed to invoke server actions, e.g. when a reverse proxy
// rewrites the Host header ("app.example.com,www.example.com").
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// The FastAPI ordering backend. Web talks to it same-origin through the
// `/api/py/*` rewrite so the session cookie flows and the CSP stays `'self'`.
const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "2mb", ...(allowedOrigins.length ? { allowedOrigins } : {}) } },
  async rewrites() {
    return [{ source: "/api/py/:path*", destination: `${apiInternalUrl}/:path*` }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Authenticated pages and exports must never be cached by shared caches.
      { source: "/(app|platform|invoice|workspaces|api|order)/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
