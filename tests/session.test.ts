import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPassword, createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";

const saved = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-secret";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("session", () => {
  it("accepts its own token and rejects a tampered or expired one", async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken(now);
    expect(await verifySessionToken(token, now)).toBe(true);
    expect(await verifySessionToken(token + "0", now)).toBe(false);
    expect(await verifySessionToken(undefined, now)).toBe(false);
    expect(await verifySessionToken("garbage", now)).toBe(false);
    expect(await verifySessionToken(token, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
  });

  it("rejects tokens signed with another secret", async () => {
    const token = await createSessionToken();
    process.env.SESSION_SECRET = "other";
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("checks the password and never accepts an unset one", () => {
    expect(checkPassword("test-password")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    delete process.env.ADMIN_PASSWORD;
    expect(checkPassword("")).toBe(false);
  });
});
