import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "@/lib/request-ip";

/** Build a header getter from a plain lower-cased map. */
function getter(headers: Record<string, string>) {
  return (name: string) => headers[name.toLowerCase()] ?? null;
}

describe("clientIpFromHeaders", () => {
  it("with one proxy hop, trusts the right-most X-Forwarded-For entry", () => {
    // Client forged 9.9.9.9; our proxy appended the real peer 1.1.1.1.
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), "1")).toBe("1.1.1.1");
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "1.1.1.1" }), "1")).toBe("1.1.1.1");
  });

  it("with two hops, counts two entries from the right", () => {
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "9.9.9.9, 2.2.2.2, 3.3.3.3" }), "2")).toBe("2.2.2.2");
  });

  it("does NOT trust the left-most entry when the chain is shorter than the configured hops", () => {
    // Regression: a forged single-entry header under hops=2 must not be trusted;
    // we fall through to x-real-ip (or "unknown"), never chain[0].
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.5.5.5" }), "2")).toBe("5.5.5.5");
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "1.2.3.4" }), "2")).toBe("unknown");
  });

  it("uses x-real-ip when configured for no proxy (hops=0)", () => {
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "7.7.7.7" }), "0")).toBe("7.7.7.7");
  });

  it("falls back to 'unknown' when no usable header is present", () => {
    expect(clientIpFromHeaders(getter({}), "1")).toBe("unknown");
  });

  it("caps absurdly long values", () => {
    const long = "1".repeat(200);
    expect(clientIpFromHeaders(getter({ "x-forwarded-for": long }), "1").length).toBe(64);
  });
});
