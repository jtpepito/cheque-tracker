import { beforeEach, describe, expect, it } from "vitest";
import { resolveSessionUser, signIn } from "@/lib/login";
import type { Sql } from "@/lib/sql";
import { createUser, resetPassword, setUserActive, SHARED_OWNER } from "@/lib/users";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});
const ADMIN = "shared-sample-pass";

describe("signIn", () => {
  it("accepts the shared password as 'owner' only while no Owner account exists", async () => {
    expect(await signIn(sql, "owner", ADMIN, ADMIN)).toEqual({ ok: true, user: SHARED_OWNER, version: 0 });
    expect(await signIn(sql, "OWNER ", ADMIN, ADMIN)).toMatchObject({ ok: true });
    expect(await signIn(sql, "owner", "wrong", ADMIN)).toEqual({ ok: false, error: "Wrong username or password." });
    expect(await signIn(sql, "someone", ADMIN, ADMIN)).toMatchObject({ ok: false });
    await createUser(sql, { username: "ana", name: "Ana", role: "owner", password: "sample-pass-1" });
    expect(await signIn(sql, "owner", ADMIN, ADMIN)).toEqual({ ok: false, error: "Wrong username or password." });
  });
  it("explains when the shared password is not set and there is no Owner yet", async () => {
    expect(await signIn(sql, "owner", "x", undefined)).toEqual({
      ok: false,
      error: "No accounts exist yet and the shared password is not set on the server.",
    });
  });
  it("signs a user in with their own password, by username in any case", async () => {
    const a = await createUser(sql, { username: "ana", name: "Ana Reyes", role: "owner", password: "sample-pass-1" });
    expect(await signIn(sql, " Ana ", "sample-pass-1", ADMIN)).toEqual({
      ok: true,
      user: { id: a.id, name: "Ana Reyes", role: "owner", canApprove: false },
      version: 1,
    });
    expect(await signIn(sql, "ana", "sample-pass-2", ADMIN)).toMatchObject({ ok: false, error: "Wrong username or password." });
    expect(await signIn(sql, "nobody", "sample-pass-1", ADMIN)).toMatchObject({ ok: false, error: "Wrong username or password." });
  });
  it("refuses a deactivated person with the same message", async () => {
    await createUser(sql, { username: "ana", name: "Ana", role: "owner", password: "sample-pass-1" });
    const b = await createUser(sql, { username: "ben", name: "Ben", role: "staff", password: "sample-pass-2" });
    await setUserActive(sql, b.id, false);
    expect(await signIn(sql, "ben", "sample-pass-2", ADMIN)).toEqual({ ok: false, error: "Wrong username or password." });
  });
});

describe("resolveSessionUser", () => {
  it("accepts the shared owner only while no Owner exists", async () => {
    expect(await resolveSessionUser(sql, { userId: "shared", version: 0 })).toEqual(SHARED_OWNER);
    await createUser(sql, { username: "ana", name: "Ana", role: "owner", password: "sample-pass-1" });
    expect(await resolveSessionUser(sql, { userId: "shared", version: 0 })).toBeNull();
  });
  it("accepts a user whose version matches, and drops them after a reset or deactivation", async () => {
    await createUser(sql, { username: "ana", name: "Ana", role: "owner", password: "sample-pass-1" });
    const b = await createUser(sql, { username: "ben", name: "Ben", role: "staff", password: "sample-pass-2" });
    expect(await resolveSessionUser(sql, { userId: b.id, version: 1 })).toEqual({ id: b.id, name: "Ben", role: "staff", canApprove: false });
    await resetPassword(sql, b.id, "sample-pass-3");
    expect(await resolveSessionUser(sql, { userId: b.id, version: 1 })).toBeNull();
    expect(await resolveSessionUser(sql, { userId: b.id, version: 2 })).toMatchObject({ id: b.id });
    await setUserActive(sql, b.id, false);
    expect(await resolveSessionUser(sql, { userId: b.id, version: 3 })).toBeNull();
    expect(await resolveSessionUser(sql, { userId: "nope", version: 1 })).toBeNull();
  });
});
