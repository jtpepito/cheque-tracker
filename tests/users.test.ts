import { beforeEach, describe, expect, it } from "vitest";
import { checkPasswordHash } from "@/lib/passwords";
import type { Sql } from "@/lib/sql";
import {
  changeOwnPassword, countActiveOwners, createUser, findByUsername, getUser, listUsers, resetPassword,
  setUserActive, setUserRole, UserError,
} from "@/lib/users";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "none";
  } catch (e) {
    return e instanceof UserError ? e.code : "other";
  }
};
const ana = { username: "Ana.Reyes", name: "Ana Reyes", role: "owner" as const, password: "sample-pass-1" };
const ben = { username: "ben", name: "Ben Cruz", role: "staff" as const, password: "sample-pass-2" };

describe("creating users", () => {
  it("stores the username in lower case and never returns the hash", async () => {
    const u = await createUser(sql, ana, 1000);
    expect(u).toMatchObject({ username: "ana.reyes", name: "Ana Reyes", role: "owner", canApprove: false, active: true, sessionVersion: 1, createdAt: 1000 });
    expect("passwordHash" in u).toBe(false);
    expect(await listUsers(sql)).toEqual([u]);
    const stored = await findByUsername(sql, "ANA.reyes");
    expect(stored?.id).toBe(u.id);
    expect(checkPasswordHash("sample-pass-1", stored!.passwordHash)).toBe(true);
  });
  it("refuses a taken username whatever its capitalisation, and bad usernames or passwords", async () => {
    await createUser(sql, ana);
    expect(await codeOf(createUser(sql, { ...ben, username: "ANA.REYES" }))).toBe("taken");
    expect(await codeOf(createUser(sql, { ...ben, username: "a b" }))).toBe("invalid");
    expect(await codeOf(createUser(sql, { ...ben, password: "short" }))).toBe("invalid");
    expect(await codeOf(createUser(sql, { ...ben, name: " " }))).toBe("invalid");
    expect(await listUsers(sql)).toHaveLength(1);
  });
  it("counts active owners", async () => {
    expect(await countActiveOwners(sql)).toBe(0);
    await createUser(sql, ana);
    await createUser(sql, ben);
    expect(await countActiveOwners(sql)).toBe(1);
  });
});

describe("owner rules", () => {
  it("never deactivates or demotes the last active owner", async () => {
    const a = await createUser(sql, ana);
    expect(await codeOf(setUserActive(sql, a.id, false))).toBe("last_owner");
    expect(await codeOf(setUserRole(sql, a.id, "staff"))).toBe("last_owner");
    const b = await createUser(sql, { ...ben, role: "owner" });
    await setUserRole(sql, a.id, "staff");
    expect((await getUser(sql, a.id))!.role).toBe("staff");
    expect(await codeOf(setUserActive(sql, b.id, false))).toBe("last_owner");
  });
  it("deactivating bumps the session version and reactivating keeps the new one", async () => {
    await createUser(sql, ana);
    const b = await createUser(sql, ben);
    const off = await setUserActive(sql, b.id, false, 5000);
    expect(off).toMatchObject({ active: false, sessionVersion: 2, updatedAt: 5000 });
    expect((await setUserActive(sql, b.id, true)).sessionVersion).toBe(2);
  });
  it("reports an unknown user", async () => {
    expect(await codeOf(setUserActive(sql, "nope", false))).toBe("not_found");
    expect(await getUser(sql, "nope")).toBeNull();
  });
});

describe("the last-owner rule under concurrency", () => {
  it("two Owners deactivating each other at the same moment leaves one active", async () => {
    const a = await createUser(sql, ana);
    const b = await createUser(sql, { ...ben, role: "owner" });
    const results = await Promise.allSettled([setUserActive(sql, a.id, false), setUserActive(sql, b.id, false)]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await countActiveOwners(sql)).toBe(1);
  });
  it("two Owners demoting each other at the same moment leaves one Owner", async () => {
    const a = await createUser(sql, ana);
    const b = await createUser(sql, { ...ben, role: "owner" });
    const results = await Promise.allSettled([setUserRole(sql, a.id, "staff"), setUserRole(sql, b.id, "staff")]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await countActiveOwners(sql)).toBe(1);
  });
});

describe("passwords", () => {
  it("a reset changes the password and bumps the version", async () => {
    const b = await createUser(sql, ben);
    const after = await resetPassword(sql, b.id, "new-sample-pass");
    expect(after.sessionVersion).toBe(2);
    expect(checkPasswordHash("new-sample-pass", (await findByUsername(sql, "ben"))!.passwordHash)).toBe(true);
    expect(await codeOf(resetPassword(sql, b.id, "short"))).toBe("invalid");
  });
  it("a person changes their own password with the current one, keeping their session", async () => {
    const b = await createUser(sql, ben);
    await changeOwnPassword(sql, b.id, "sample-pass-2", "another-sample");
    expect((await getUser(sql, b.id))!.sessionVersion).toBe(1);
    expect(checkPasswordHash("another-sample", (await findByUsername(sql, "ben"))!.passwordHash)).toBe(true);
    expect(await codeOf(changeOwnPassword(sql, b.id, "wrong", "another-sample-2"))).toBe("invalid");
  });
});
