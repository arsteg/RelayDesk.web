/**
 * Client IP for rate limiting.
 *
 * X-Forwarded-For is a comma-separated list where each proxy appends the
 * address it received the request from. Anything to the left of what our own
 * proxies appended is client-controlled and can be forged, so we count
 * TRUSTED_PROXY_HOPS entries from the right (default 1: a single load
 * balancer / reverse proxy in front of the app). Set it to 0 when the app is
 * exposed directly, in which case X-Real-IP (set by the server) is used.
 */
export function clientIpFromHeaders(get: (name: string) => string | null, hopsEnv = process.env.TRUSTED_PROXY_HOPS): string {
  const hops = Math.max(0, Number.parseInt(hopsEnv ?? "1", 10) || 0);
  if (hops > 0) {
    const chain = (get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    // Count trusted hops from the right. If the chain is shorter than the
    // configured hop count we cannot identify a trusted entry, so fall through
    // to x-real-ip rather than trusting the client-controlled left-most value.
    const idx = chain.length - hops;
    if (idx >= 0 && chain[idx]) return chain[idx].slice(0, 64);
  }
  return (get("x-real-ip") ?? "unknown").trim().slice(0, 64) || "unknown";
}
