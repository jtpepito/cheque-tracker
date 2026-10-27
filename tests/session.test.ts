import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";

const saved = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-secret";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("session tokens", () => {
  it("carry the user id and version, and reject tampering and expiry", async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken("u1", 3, now);
    expect(await verifySessionToken(token, now)).toEqual({ userId: "u1", version: 3 });
    expect(await verifySessionToken(token.replace(".3.", ".4."), now)).toBeNull();
    expect(await verifySessionToken(token.replace("u1", "u2"), now)).toBeNull();
    expect(await verifySessionToken(token + "0", now)).toBeNull();
    expect(await verifySessionToken(undefined, now)).toBeNull();
    expect(await verifySessionToken("garbage", now)).toBeNull();
    expect(await verifySessionToken(token, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBeNull();
  });
  it("rejects tokens signed with another secret", async () => {
    const token = await createSessionToken("u1", 1);
    process.env.SESSION_SECRET = "other";
    expect(await verifySessionToken(token)).toBeNull();
  });
  it("never falls back to the shared password as the signing key", async () => {
    const token = await createSessionToken("u1", 1);
    delete process.env.SESSION_SECRET;
    await expect(createSessionToken("u1", 1)).rejects.toThrow("SESSION_SECRET");
    expect(await verifySessionToken(token)).toBeNull();
  });
  it("accepts only plain digits for the expiry and version", async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken("u1", 1, now);
    const [exp, id, version, sig] = token.split(".");
    expect(await verifySessionToken(`${exp}.${id}.${version}e0.${sig}`, now)).toBeNull();
    expect(await verifySessionToken(`0x${Number(exp).toString(16)}.${id}.${version}.${sig}`, now)).toBeNull();
  });
});
