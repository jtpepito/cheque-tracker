import { describe, expect, it } from "vitest";
import { newNonce, securityHeaders } from "@/lib/csp";

describe("security headers", () => {
  it("lock the page to its own origin, allow only nonce'd scripts, and refuse framing", () => {
    const h = securityHeaders("abc123", false);
    const csp = h["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
  });
  it("allows eval and the reload socket only in development", () => {
    const csp = securityHeaders("n", true)["Content-Security-Policy"];
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });
  it("makes a fresh nonce each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(newNonce()).not.toBe(a);
  });
});
