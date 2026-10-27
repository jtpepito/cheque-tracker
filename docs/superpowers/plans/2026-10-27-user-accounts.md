# User Accounts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each person signs in as themselves with a role; Owners manage users; the shared password is retired once an Owner exists; balances, company assignments and vouchers record who did them.

**Architecture:** A `users` table with scrypt password hashes. The session cookie now carries the user id and a session version; middleware still checks only the signature at the edge, while `guarded()` loads the user on every API request and refuses inactive users or stale versions. `lib/login.ts` holds the sign-in decision (shared password only while no Owner exists). A `/users` page for Owners. Existing stores gain an optional "by" name.

**Tech Stack:** As the app today. `node:crypto` scrypt for hashes. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-27-user-accounts-design.md`

## Global Constraints

- Project folder `C:\WWJ\Claude Coding\Cheques`; `npm.cmd` / `npx.cmd`. Tests `npm.cmd test`, typecheck `npm.cmd run typecheck`.
- Username: 3–30 characters of letters, digits, `.`, `_`, `-`; stored and compared lower-case. Password: at least 8 characters. Hash format `scrypt$<salt hex>$<hash hex>`, N=16384, r=8, p=1, 64-byte key.
- Cookie value `<expiry>.<user id>.<version>.<hmac>`; the shared Owner has id `shared` and version `0`, accepted only while no active Owner exists.
- Roles are exactly `owner` and `staff`. The last active Owner can be neither deactivated nor demoted.
- Lockout: 10 attempts per 15 minutes per `ip:<address>` and per `user:<username>`.
- Error messages: "Wrong username or password." for every sign-in failure other than lockout.
- Real names and passwords never enter git or tests; tests use made-up people.
- Run `npm.cmd run migrate` against production before pushing.
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **The owner creates their account and the shared password is still typed by someone.** Refused the moment an active Owner exists, even inside a session that was opened with it. Tests in Tasks 3 and 4.
2. **A deactivated person keeps a page open.** Their next API request gets 401 and the page sends them to sign-in; the sheet sync (key-based) is unaffected. Tests in Task 3.
3. **An Owner tries to deactivate or demote the last Owner, including themselves.** Refused with a clear message. Test in Task 2.
4. **Two people register the same username with different capitalisation.** Refused as taken. Test in Task 2.
5. **A password reset while the person is signed in.** Their old session stops working; the new password works. Test in Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/005_users.sql` (new) | `users` table, audit columns |
| `lib/passwords.ts` (new) | Hashing, checking, username and password rules |
| `lib/users.ts` (new) | User store and the Owner rules |
| `lib/session.ts` (rewritten) | Tokens carrying user id and version |
| `lib/login.ts` (new) | The sign-in decision |
| `lib/auth.ts`, `lib/http.ts` | `currentUser`, `guarded(handler(user))`, `ownerOnly` |
| `app/login/*` | Username + password form |
| `app/api/me/route.ts`, `app/api/me/password/route.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/users/[id]/password/route.ts` (new) | Routes |
| `app/users/page.tsx`, `components/users-admin.tsx`, `components/change-password.tsx` (new) | Pages |
| `lib/cheques.ts`, `lib/vouchers.ts`, `lib/projection.ts`, routes, `components/balances.tsx`, `components/voucher-editor.tsx`, `components/header.tsx`, `components/tracker.tsx` | "by" names |

---

### Task 1: Table, hashing and rules

**Files:**
- Create: `db/migrations/005_users.sql`, `lib/passwords.ts`
- Modify: `tests/db.ts`, `tests/migrate.test.ts`
- Test: `tests/passwords.test.ts`

**Interfaces:**
- `hashPassword(password: string): string`, `checkPasswordHash(password: string, stored: string): boolean`
- `normalizeUsername(raw: unknown): string` (trimmed, lower-case; "" when not a string)
- `usernameProblem(raw: unknown): string | null`, `passwordProblem(raw: unknown): string | null` (a message, or null when fine)

- [ ] **Step 1: Failing tests**

`tests/migrate.test.ts`: applied list adds `"005_users.sql"`; table list becomes `["balances", "cheques", "config", "holidays", "invoices", "login_failures", "schema_migrations", "users", "voucher_lines", "voucher_series", "vouchers"]`. `tests/db.ts`: add `users` to the TRUNCATE list.

`tests/passwords.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkPasswordHash, hashPassword, normalizeUsername, passwordProblem, usernameProblem } from "@/lib/passwords";

describe("password hashing", () => {
  it("checks a password against its hash and nothing else", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(checkPasswordHash("correct horse battery", stored)).toBe(true);
    expect(checkPasswordHash("correct horse batter", stored)).toBe(false);
    expect(checkPasswordHash("correct horse battery", "nonsense")).toBe(false);
    expect(checkPasswordHash("correct horse battery", "")).toBe(false);
  });
  it("salts, so the same password hashes differently each time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("username and password rules", () => {
  it("normalises usernames to lower case", () => {
    expect(normalizeUsername("  Ana.Reyes ")).toBe("ana.reyes");
    expect(normalizeUsername(5)).toBe("");
  });
  it("accepts 3 to 30 characters of letters, digits, dot, underscore and dash", () => {
    expect(usernameProblem("ana")).toBeNull();
    expect(usernameProblem("ana.reyes_2-x")).toBeNull();
    expect(usernameProblem("ab")).toBe("Username: 3 to 30 characters, letters, digits, dots, underscores or dashes.");
    expect(usernameProblem("a".repeat(31))).not.toBeNull();
    expect(usernameProblem("ana reyes")).not.toBeNull();
    expect(usernameProblem("ana@x")).not.toBeNull();
    expect(usernameProblem(null)).not.toBeNull();
  });
  it("requires passwords of at least 8 characters", () => {
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("1234567")).toBe("Password: at least 8 characters.");
    expect(passwordProblem("")).not.toBeNull();
    expect(passwordProblem(undefined)).not.toBeNull();
    expect(passwordProblem("x".repeat(201))).toBe("Password: at most 200 characters.");
  });
});
```

Run: `npm.cmd test` — expected: FAIL.

- [ ] **Step 2: Write the migration and module**

`db/migrations/005_users.sql`:
```sql
-- People who sign in, with a role. The shared password is only accepted while this table has
-- no active owner.
CREATE TABLE users (
  id              text PRIMARY KEY,
  username        text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('owner','staff')),
  can_approve     boolean NOT NULL DEFAULT false,
  password_hash   text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  created_at      bigint NOT NULL,
  updated_at      bigint NOT NULL
);
CREATE UNIQUE INDEX users_username ON users (lower(username));
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Who did what, as the person's name at the time.
ALTER TABLE balances ADD COLUMN updated_by text;
ALTER TABLE cheques ADD COLUMN company_set_by text;
ALTER TABLE vouchers ADD COLUMN created_by text;
ALTER TABLE vouchers ADD COLUMN updated_by text;
```

`lib/passwords.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords are stored as scrypt hashes with a random salt: "scrypt$<salt hex>$<hash hex>".

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_BYTES, PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function checkPasswordHash(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_BYTES) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_BYTES, PARAMS);
  return timingSafeEqual(hash, expected);
}

export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function usernameProblem(raw: unknown): string | null {
  const u = normalizeUsername(raw);
  return /^[a-z0-9._-]{3,30}$/.test(u) ? null : "Username: 3 to 30 characters, letters, digits, dots, underscores or dashes.";
}

export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 8) return "Password: at least 8 characters.";
  if (raw.length > 200) return "Password: at most 200 characters.";
  return null;
}
```

- [ ] **Step 3: Test and commit**

Run: `npm.cmd test` — expected: PASS.

```bash
git add -A
git commit -m "feat(users): users table, audit columns, password hashing and rules"
```

---

### Task 2: The user store

**Files:**
- Create: `lib/users.ts`
- Test: `tests/users.test.ts`

**Interfaces:**
- `type Role = "owner" | "staff"`
- `type User = { id: string; username: string; name: string; role: Role; canApprove: boolean; active: boolean; sessionVersion: number; createdAt: number; updatedAt: number }`
- `type SessionUser = { id: string; name: string; role: Role; canApprove: boolean }`
- `class UserError extends Error { code: "not_found" | "taken" | "invalid" | "last_owner" }`
- `listUsers(sql)`, `getUser(sql, id)`, `findByUsername(sql, username): Promise<(User & { passwordHash: string }) | null>`, `countActiveOwners(sql)`
- `createUser(sql, { username, name, role, password }, now?)`, `setUserActive(sql, id, active, now?)`, `setUserRole(sql, id, role, now?)`, `resetPassword(sql, id, password, now?)` (bumps version), `changeOwnPassword(sql, id, current, next, now?)` (no bump)
- `SHARED_OWNER: SessionUser = { id: "shared", name: "Owner (shared password)", role: "owner", canApprove: true }`

- [ ] **Step 1: Failing test**

`tests/users.test.ts`:
```ts
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
```

Run: `npm.cmd test` — expected: FAIL, cannot resolve `@/lib/users`.

- [ ] **Step 2: Write `lib/users.ts`**

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { checkPasswordHash, hashPassword, normalizeUsername, passwordProblem, usernameProblem } from "./passwords";
import type { Sql } from "./sql";

export type Role = "owner" | "staff";

export type User = {
  id: string;
  username: string;
  name: string;
  role: Role;
  canApprove: boolean;
  active: boolean;
  sessionVersion: number;
  createdAt: number;
  updatedAt: number;
};

/** What a signed-in request knows about its user. */
export type SessionUser = { id: string; name: string; role: Role; canApprove: boolean };

/** Signs in with ADMIN_PASSWORD while no Owner account exists yet. */
export const SHARED_OWNER: SessionUser = { id: "shared", name: "Owner (shared password)", role: "owner", canApprove: true };

export class UserError extends Error {
  constructor(
    public code: "not_found" | "taken" | "invalid" | "last_owner",
    message: string,
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;
const toUser = (r: Row): User => ({
  id: r.id as string,
  username: r.username as string,
  name: r.name as string,
  role: r.role as Role,
  canApprove: r.can_approve === true,
  active: r.active === true,
  sessionVersion: Number(r.session_version),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const COLUMNS = "id, username, name, role, can_approve, active, session_version, created_at, updated_at";

export async function listUsers(sql: Sql): Promise<User[]> {
  return (await sql.query<Row>(`SELECT ${COLUMNS} FROM users ORDER BY created_at, username`)).map(toUser);
}

export async function getUser(sql: Sql, id: string): Promise<User | null> {
  const row = (await sql.query<Row>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]))[0];
  return row ? toUser(row) : null;
}

export async function findByUsername(sql: Sql, username: unknown): Promise<(User & { passwordHash: string }) | null> {
  const row = (await sql.query<Row>(`SELECT ${COLUMNS}, password_hash FROM users WHERE lower(username) = $1`, [normalizeUsername(username)]))[0];
  return row ? { ...toUser(row), passwordHash: row.password_hash as string } : null;
}

export async function countActiveOwners(sql: Sql): Promise<number> {
  return Number((await sql.query<{ n: unknown }>("SELECT count(*) AS n FROM users WHERE role = 'owner' AND active"))[0].n);
}

async function mustGet(sql: Sql, id: string): Promise<User> {
  const user = await getUser(sql, id);
  if (!user) throw new UserError("not_found", "That user no longer exists.");
  return user;
}

/** Refuses a change that would leave no active Owner. */
async function guardLastOwner(sql: Sql, user: User): Promise<void> {
  if (user.role === "owner" && user.active && (await countActiveOwners(sql)) <= 1) {
    throw new UserError("last_owner", "There must be at least one active Owner.");
  }
}

export async function createUser(
  sql: Sql,
  input: { username: unknown; name: unknown; role: unknown; password: unknown },
  now: number = Date.now(),
): Promise<User> {
  const problem = usernameProblem(input.username) ?? passwordProblem(input.password);
  if (problem) throw new UserError("invalid", problem);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new UserError("invalid", "Name: enter the person's name.");
  if (input.role !== "owner" && input.role !== "staff") throw new UserError("invalid", "Role: choose Owner or Staff.");
  const username = normalizeUsername(input.username);
  if (await findByUsername(sql, username)) throw new UserError("taken", "That username is already used.");
  const id = randomUUID();
  try {
    await sql.query(
      `INSERT INTO users (id, username, name, role, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [id, username, name, input.role, hashPassword(input.password as string), now],
    );
  } catch (err) {
    // Two people adding the same username at once: the unique index catches the second.
    if ((err as { code?: string }).code === "23505") throw new UserError("taken", "That username is already used.");
    throw err;
  }
  return (await getUser(sql, id))!;
}

export async function setUserActive(sql: Sql, id: string, active: boolean, now: number = Date.now()): Promise<User> {
  const user = await mustGet(sql, id);
  if (!active && user.active) await guardLastOwner(sql, user);
  // Deactivating ends every session the person has; reactivating does not revive them.
  const bump = !active && user.active ? ", session_version = session_version + 1" : "";
  await sql.query(`UPDATE users SET active = $2, updated_at = $3${bump} WHERE id = $1`, [id, active, now]);
  return (await getUser(sql, id))!;
}

export async function setUserRole(sql: Sql, id: string, role: Role, now: number = Date.now()): Promise<User> {
  const user = await mustGet(sql, id);
  if (role === "staff" && user.role === "owner") await guardLastOwner(sql, user);
  await sql.query("UPDATE users SET role = $2, updated_at = $3 WHERE id = $1", [id, role, now]);
  return (await getUser(sql, id))!;
}

/** By an Owner: a new password and an end to the person's current sessions. */
export async function resetPassword(sql: Sql, id: string, password: unknown, now: number = Date.now()): Promise<User> {
  const problem = passwordProblem(password);
  if (problem) throw new UserError("invalid", problem);
  await mustGet(sql, id);
  await sql.query("UPDATE users SET password_hash = $2, session_version = session_version + 1, updated_at = $3 WHERE id = $1", [
    id,
    hashPassword(password as string),
    now,
  ]);
  return (await getUser(sql, id))!;
}

/** By the person themselves, proving the current password. Their session stays valid. */
export async function changeOwnPassword(sql: Sql, id: string, current: unknown, next: unknown, now: number = Date.now()): Promise<void> {
  const problem = passwordProblem(next);
  if (problem) throw new UserError("invalid", problem);
  const row = (await sql.query<Row>("SELECT password_hash FROM users WHERE id = $1 AND active", [id]))[0];
  if (!row) throw new UserError("not_found", "That user no longer exists.");
  if (typeof current !== "string" || !checkPasswordHash(current, row.password_hash as string)) {
    throw new UserError("invalid", "Current password: that is not your current password.");
  }
  await sql.query("UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1", [id, hashPassword(next as string), now]);
}
```

- [ ] **Step 3: Test and commit**

Run: `npm.cmd test` — expected: PASS.

```bash
git add -A
git commit -m "feat(users): user store with owner rules and password changes"
```

---

### Task 3: Sessions carry the user; the sign-in decision

**Files:**
- Rewrite: `lib/session.ts`, `lib/auth.ts`, `lib/http.ts`, `tests/session.test.ts`
- Create: `lib/login.ts`
- Test: `tests/login.test.ts`

**Interfaces:**
- `lib/session.ts`: `createSessionToken(userId: string, version: number, now?): Promise<string>`; `verifySessionToken(token, now?): Promise<{ userId: string; version: number } | null>`; `checkPassword` (shared) and `safeEqual`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS` unchanged.
- `lib/login.ts`: `signIn(sql, username: unknown, password: unknown, adminPassword = process.env.ADMIN_PASSWORD): Promise<{ ok: true; user: SessionUser; version: number } | { ok: false; error: string }>`; `resolveSessionUser(sql, token: { userId, version }): Promise<SessionUser | null>`.
- `lib/auth.ts`: `currentUser(sql): Promise<SessionUser | null>`; `cookieSecure()` unchanged.
- `lib/http.ts`: `guarded(handler: (user: SessionUser) => Promise<NextResponse> | NextResponse)`; `ownerOnly(handler)` (403 "Owners only." for staff); `badRequest`, `readObject` unchanged; `UserError` mapped (not_found 404, taken 409, last_owner 409, invalid 400).

- [ ] **Step 1: Failing tests**

`tests/session.test.ts` (replace):
```ts
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
  it("checks the shared password and never accepts an unset one", () => {
    expect(checkPassword("test-password")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    delete process.env.ADMIN_PASSWORD;
    expect(checkPassword("")).toBe(false);
  });
});
```

`tests/login.test.ts`:
```ts
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
```

Run: `npm.cmd test` — expected: FAIL.

- [ ] **Step 2: Write the code**

`lib/session.ts`:
```ts
// HMAC-signed session cookie. Uses Web Crypto so the same code runs in middleware (edge
// runtime) and in route handlers (Node). The cookie says who is signed in and which session
// version they had; whether that is still valid is checked against the database by the routes.

export const SESSION_COOKIE = process.env.NODE_ENV === "development" ? "cheques_dev_session" : "cheques_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export type SessionToken = { userId: string; version: number };

/** Cookie value: "<expiry-unix-seconds>.<user id>.<version>.<hmac>". */
export async function createSessionToken(userId: string, version: number, now = Date.now()): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${userId}.${version}.${await hmac(key, `session:${exp}:${userId}:${version}`)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<SessionToken | null> {
  const key = secret();
  if (!key || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [expStr, userId, versionStr, sig] = parts;
  const exp = Number(expStr);
  const version = Number(versionStr);
  if (!Number.isInteger(exp) || !Number.isInteger(version) || !userId || !sig || exp < now / 1000) return null;
  return safeEqual(sig, await hmac(key, `session:${exp}:${userId}:${version}`)) ? { userId, version } : null;
}

/** The shared password, used only until the first Owner account exists. */
export function checkPassword(attempt: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(attempt, expected);
}
```

`lib/login.ts`:
```ts
import "server-only";
import { checkPasswordHash, normalizeUsername } from "./passwords";
import { safeEqual, type SessionToken } from "./session";
import type { Sql } from "./sql";
import { countActiveOwners, findByUsername, getUser, SHARED_OWNER, type SessionUser } from "./users";

// Who may sign in, and whether a cookie still stands for someone.

const WRONG = "Wrong username or password.";

export async function signIn(
  sql: Sql,
  username: unknown,
  password: unknown,
  adminPassword: string | undefined = process.env.ADMIN_PASSWORD,
): Promise<{ ok: true; user: SessionUser; version: number } | { ok: false; error: string }> {
  const name = normalizeUsername(username);
  const pass = typeof password === "string" ? password : "";
  if ((await countActiveOwners(sql)) === 0) {
    // Until someone has made the first Owner account, only the shared password gets in.
    if (!adminPassword) return { ok: false, error: "No accounts exist yet and the shared password is not set on the server." };
    if (name === "owner" && safeEqual(pass, adminPassword)) return { ok: true, user: SHARED_OWNER, version: 0 };
    return { ok: false, error: WRONG };
  }
  const user = await findByUsername(sql, name);
  if (!user || !user.active || !checkPasswordHash(pass, user.passwordHash)) return { ok: false, error: WRONG };
  return { ok: true, user: { id: user.id, name: user.name, role: user.role, canApprove: user.canApprove }, version: user.sessionVersion };
}

/** The person a valid cookie stands for, or null when they are gone, deactivated, or reset since. */
export async function resolveSessionUser(sql: Sql, token: SessionToken): Promise<SessionUser | null> {
  if (token.userId === SHARED_OWNER.id) {
    return token.version === 0 && (await countActiveOwners(sql)) === 0 ? SHARED_OWNER : null;
  }
  const user = await getUser(sql, token.userId);
  if (!user || !user.active || user.sessionVersion !== token.version) return null;
  return { id: user.id, name: user.name, role: user.role, canApprove: user.canApprove };
}
```

`lib/auth.ts`:
```ts
import "server-only";
import { cookies, headers } from "next/headers";
import { resolveSessionUser } from "./login";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import type { Sql } from "./sql";
import type { SessionUser } from "./users";

/** The signed-in person, checked against the database. Middleware already checked the signature. */
export async function currentUser(sql: Sql): Promise<SessionUser | null> {
  const token = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return token ? resolveSessionUser(sql, token) : null;
}

/** Mark cookies Secure when the request came over HTTPS (Vercel), not on plain-HTTP localhost. */
export async function cookieSecure(): Promise<boolean> {
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (h.get("origin") ?? "").startsWith("https://");
}
```

`lib/http.ts`:
```ts
import "server-only";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { ChequeError } from "./cheques";
import { getSql } from "./db";
import type { SessionUser } from "./users";
import { UserError } from "./users";
import { VoucherError } from "./vouchers";

type Handler = (user: SessionUser) => Promise<NextResponse> | NextResponse;

const unauthorized = () => NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });

/** Checks the session against the database, runs the handler, and turns known errors into JSON. */
export async function guarded(handler: Handler): Promise<NextResponse> {
  let user: SessionUser | null;
  try {
    user = await currentUser(await getSql());
  } catch (err) {
    console.error("[api] session check failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  if (!user) return unauthorized();
  try {
    return await handler(user);
  } catch (err) {
    if (err instanceof ChequeError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof VoucherError) {
      const status = err.code === "not_found" ? 404 : err.code === "unassigned" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    if (err instanceof UserError) {
      const status = err.code === "not_found" ? 404 : err.code === "invalid" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[api] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

/** As guarded, for Owners only. */
export function ownerOnly(handler: Handler): Promise<NextResponse> {
  return guarded((user) => (user.role === "owner" ? handler(user) : NextResponse.json({ error: "Owners only." }, { status: 403 })));
}

export const badRequest = (error: string, errors?: Record<string, string>) =>
  NextResponse.json({ error, errors }, { status: 400 });

/** The request body as a plain object, or null when it is not a JSON object. */
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
```
(`guarded` now opens the database itself; existing routes that call `getSql()` inside their handler keep working, since `getSql()` returns the cached handle.)

`app/login/actions.ts` (replace):
```ts
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSecure } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { signIn } from "@/lib/login";
import { allowAttempt, clearAttempts } from "@/lib/login-throttle";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { normalizeUsername } from "@/lib/passwords";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const username = normalizeUsername(fd.get("username"));
  const password = String(fd.get("password") ?? "");
  let outcome: Awaited<ReturnType<typeof signIn>>;
  try {
    const sql = await getSql();
    // At most ten attempts in 15 minutes per address and per username, counted before the
    // password is looked at, so a burst sent at once cannot slip past.
    const allowed = (await allowAttempt(sql, `ip:${ip}`)) && (await allowAttempt(sql, `user:${username}`));
    if (!allowed) return { error: "Too many wrong passwords. Try again in 15 minutes." };
    outcome = await signIn(sql, username, password);
    if (outcome.ok) {
      await clearAttempts(sql, `ip:${ip}`);
      await clearAttempts(sql, `user:${username}`);
    }
  } catch (err) {
    console.error("[login] database error:", err instanceof Error ? err.message : err);
    return { error: "Something went wrong. Try again." };
  }
  if (!outcome.ok) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: outcome.error };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(outcome.user.id, outcome.version), {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
```

`app/login/login-form.tsx`: add a username field above the password field:
```tsx
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          Username
        </label>
        <input id="username" name="username" autoComplete="username" autoFocus required className="field" />
      </div>
```
and remove `autoFocus` from the password input. `app/login/page.tsx`: under the form card add:
```tsx
      <p className="text-center text-xs text-muted">
        First time? Sign in with username <span className="font-mono">owner</span> and the shared password, then create your
        own account under Users.
      </p>
```

`middleware.ts`: unchanged in behaviour; `verifySessionToken` now returns an object or null, so `const authed = !!(await verifySessionToken(...))`.

Other callers of `verifySessionToken`/`createSessionToken`: `lib/auth.ts` (rewritten above) and the login action only. Remove `isSignedIn` from `lib/auth.ts`; nothing else uses it.

- [ ] **Step 3: Test, typecheck, commit**

Run: `npm.cmd test` — expected: PASS. Run: `npm.cmd run typecheck` — expected: no errors (fix any route that referenced `isSignedIn`).

```bash
git add -A
git commit -m "feat(users): sessions name the user; sign-in by username, shared password only until an Owner exists"
```

---

### Task 4: Routes, and "by" names on existing actions

**Files:**
- Create: `app/api/me/route.ts`, `app/api/me/password/route.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/users/[id]/password/route.ts`
- Modify: `lib/cheques.ts` (`setBalance` and `setCompany` take `by`; `listBalances` returns `updatedBy`), `lib/projection.ts` (`Balance.updatedBy?`, `CompanyProjection.updatedBy`), `lib/vouchers.ts` (`createdBy`/`updatedBy`; `createVoucherForCheque(sql, chequeId, today, now?, by?)` pre-fills `preparedBy`; `updateVoucher(sql, id, input, now?, by?)`), the balances, cheques/[id], vouchers routes, `app/api/state/route.ts` (adds `me: SessionUser`)
- Tests: additions to `tests/balances.test.ts`, `tests/cheques.test.ts`, `tests/vouchers.test.ts`

**Interfaces:**
- `GET /api/me` → `SessionUser`
- `PUT /api/me/password` `{ current, next }` → `200 {}` | 400
- Owners only: `GET /api/users` → `User[]`; `POST /api/users` `{ username, name, role, password }` → `201 User` | 400 | 409; `PATCH /api/users/:id` `{ active?: boolean; role?: Role }` → `200 User` | 404 | 409; `POST /api/users/:id/password` `{ next }` → `200 User` | 400 | 404
- `/api/state` adds `me`.

- [ ] **Step 1: Failing tests (store changes)**

Append to `tests/balances.test.ts`:
```ts
describe("who entered a balance", () => {
  it("remembers the name, or null when none was given", async () => {
    await setBalance(sql, "wwj", 1, 1000, "Ana Reyes");
    await setBalance(sql, "wythlae", 2, 2000);
    expect(await listBalances(sql)).toEqual([
      { company: "wwj", amount: 1, updatedAt: 1000, updatedBy: "Ana Reyes" },
      { company: "wythlae", amount: 2, updatedAt: 2000, updatedBy: null },
    ]);
  });
});
```
and in the existing balances tests, add `updatedBy: null` to each expected balance object (`toEqual` is exact).

Append to `tests/cheques.test.ts`:
```ts
  it("remembers who chose the company", async () => {
    const c = cheque({ id: "who-1", company: "unassigned" });
    await upsertCheque(sql, c);
    await setCompany(sql, c.id, "wwj", "Ben Cruz");
    expect((await listCheques(sql))[0]).toMatchObject({ company: "wwj", companySetBy: "Ben Cruz" });
  });
```
(inside the `describe("cheques store"`, before its closing). Add `companySetBy: null,` to `tests/helpers.ts` and to the `toEqual({ ...row(), companyLocked: false, statusChangedAt: null })` expectation in `tests/import.test.ts`.

Append to `tests/vouchers.test.ts`:
```ts
describe("who made and saved a voucher", () => {
  it("records the maker, pre-fills Prepared by, and records the last saver", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000, "Ana Reyes");
    expect(v).toMatchObject({ createdBy: "Ana Reyes", updatedBy: null, preparedBy: "Ana Reyes" });
    const saved = await updateVoucher(sql, v.id, { ...toInput(v), preparedBy: "Ana R." }, 2000, "Ben Cruz");
    expect(saved).toMatchObject({ createdBy: "Ana Reyes", updatedBy: "Ben Cruz", preparedBy: "Ana R." });
    const anon = await createVoucherForCheque(sql, "c2", TODAY);
    expect(anon).toMatchObject({ createdBy: null, preparedBy: "" });
  });
});
```
with, near the top of that file, a helper:
```ts
const toInput = (v: Voucher): VoucherInput => ({
  voucherDate: v.voucherDate, payee: v.payee, amount: v.amount, preparedBy: v.preparedBy, checkedBy: v.checkedBy,
  approvedBy: v.approvedBy, receivedBy: v.receivedBy, notes: v.notes,
  lines: v.lines.map(({ invoiceNo, invoiceDate, description, gross, ewt, net }) => ({ invoiceNo, invoiceDate, description, gross, ewt, net })),
});
```
(import `type Voucher` from `@/lib/vouchers`.)

Run: `npm.cmd test` — expected: FAIL.

- [ ] **Step 2: Store changes**

`lib/types.ts`: `Cheque` gains `companySetBy: string | null;` after `statusChangedAt`. `lib/cheques.ts`: `toCheque` maps `company_set_by`; `upsertCheque` writes it (16th column, preserved like `company_locked` on conflict: `company_set_by = CASE WHEN cheques.company_locked THEN cheques.company_set_by ELSE excluded.company_set_by END`); `setCompany(sql, id, company, by: string | null = null)` sets `company_set_by = $3`; `listBalances` maps `updated_by`; `setBalance(sql, company, amount, now?, by: string | null = null)` writes `updated_by`. `lib/import.ts`: `companySetBy: null`. `lib/sync.ts`: `companySetBy: old?.companySetBy ?? null` in `next`. `tests/helpers.ts`: `companySetBy: null`.

`lib/projection.ts`: `Balance` gains `updatedBy?: string | null`; `CompanyProjection` gains `updatedBy: string | null` (from the balance, else null).

`lib/vouchers.ts`: `Voucher` gains `createdBy: string | null; updatedBy: string | null` (mapped from `created_by`, `updated_by`). `createVoucherForCheque(sql, chequeId, today, now = Date.now(), by: string | null = null)` inserts `created_by = by` and `prepared_by = by ?? ""`. `updateVoucher(sql, id, input, now = Date.now(), by: string | null = null)` sets `updated_by = by`. `listVouchers` includes both.

- [ ] **Step 3: Routes**

`app/api/me/route.ts`:
```ts
import { NextResponse } from "next/server";
import { guarded } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded((user) => NextResponse.json(user));
}
```

`app/api/me/password/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { changeOwnPassword, SHARED_OWNER } from "@/lib/users";

export function PUT(req: Request) {
  return guarded(async (user) => {
    if (user.id === SHARED_OWNER.id) return badRequest("Create your own account first; the shared password is set on the server.");
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    await changeOwnPassword(await getSql(), user.id, body.current, body.next);
    return NextResponse.json({});
  });
}
```

`app/api/users/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { createUser, listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export function GET() {
  return ownerOnly(async () => NextResponse.json(await listUsers(await getSql())));
}

export function POST(req: Request) {
  return ownerOnly(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const user = await createUser(await getSql(), { username: body.username, name: body.name, role: body.role, password: body.password });
    return NextResponse.json(user, { status: 201 });
  });
}
```

`app/api/users/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { getUser, setUserActive, setUserRole } from "@/lib/users";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerOnly(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const sql = await getSql();
    if (typeof body.active === "boolean") await setUserActive(sql, id, body.active);
    if (body.role === "owner" || body.role === "staff") await setUserRole(sql, id, body.role);
    const user = await getUser(sql, id);
    return user ? NextResponse.json(user) : NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  });
}
```

`app/api/users/[id]/password/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { resetPassword } from "@/lib/users";

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerOnly(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    return NextResponse.json(await resetPassword(await getSql(), id, body.next));
  });
}
```

Existing routes: `app/api/balances/route.ts` → `guarded(async (user) => … setBalance(sql, company, amount, Date.now(), user.name))`; `app/api/cheques/[id]/route.ts` → `setCompany(sql, id, company, user.name)`; `app/api/vouchers/route.ts` POST → `createVoucherForCheque(sql, chequeId, todayManila(), Date.now(), user.name)`; `app/api/vouchers/[id]/route.ts` PUT → `updateVoucher(sql, id, value, Date.now(), user.name)`; `app/api/state/route.ts` → `guarded(async (user) => …)` and add `me: user` to the JSON.

- [ ] **Step 4: Test, typecheck, build, commit**

Run: `npm.cmd test` — expected: PASS. `npm.cmd run typecheck` — no errors. Build into `.next-check` — "Compiled successfully" with `/api/me`, `/api/me/password`, `/api/users`, `/api/users/[id]`, `/api/users/[id]/password`.

```bash
git add -A
git commit -m "feat(users): user routes; balances, company choices and vouchers record who did them"
```

---

### Task 5: Pages

**Files:**
- Create: `app/users/page.tsx`, `components/users-admin.tsx`, `components/change-password.tsx`
- Modify: `components/header.tsx` (name, Users link for Owners, Change password), `components/tracker.tsx` (`me` in state), `components/balances.tsx` ("by"), `components/voucher-editor.tsx` ("Made by … · last saved by …")

- [ ] **Step 1: Users page**

`app/users/page.tsx`:
```tsx
import { UsersAdmin } from "@/components/users-admin";

export const metadata = { title: "Users · Cheque Funding Tracker" };

export default function Page() {
  return <UsersAdmin />;
}
```

`components/users-admin.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { manilaTime } from "@/lib/sync-status";
import type { Role, SessionUser, User } from "@/lib/users";

type NewUser = { username: string; name: string; role: Role; password: string };
const blank: NewUser = { username: "", name: "", role: "staff", password: "" };

export function UsersAdmin() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [draft, setDraft] = useState<NewUser>(blank);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setMe(await api<SessionUser>("/api/me"));
      setUsers(await api<User[]>("/api/users"));
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't load the users." });
      setUsers([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
      setMessage({ kind: "ok", text: label });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(`Added ${draft.name}. Tell them their username and starting password.`, async () => {
      await api<User>("/api/users", "POST", draft);
      setDraft(blank);
    });
  }

  function reset(u: User) {
    const next = window.prompt(`New starting password for ${u.name} (at least 8 characters). They will be signed out everywhere.`);
    if (next === null) return;
    run(`Password reset for ${u.name}.`, () => api(`/api/users/${u.id}/password`, "POST", { next }));
  }

  if (me && me.role !== "owner") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p>Only Owners can manage users.</p>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Users</h1>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>
      {me?.id === "shared" && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          You are signed in with the shared password. Create your own Owner account below, then sign out and sign in as
          yourself. The shared password stops working once an Owner account exists.
        </p>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1">
          <span className="block text-muted">Name</span>
          <input className="field" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Username</span>
          <input className="field" required maxLength={30} autoComplete="off" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Role</span>
          <select className="field" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Starting password</span>
          <input className="field" type="text" required minLength={8} autoComplete="off" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary h-10 w-full" disabled={busy}>
            Add user
          </button>
        </div>
      </form>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
          {message.text}
        </p>
      )}

      <ul className="space-y-1.5 text-sm">
        {(users ?? []).map((u) => (
          <li key={u.id} className={`grid gap-2 rounded-lg border border-line bg-card p-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-center ${u.active ? "" : "opacity-60"}`}>
            <div>
              <p className="font-medium">{u.name}</p>
              <p className="text-xs text-muted">added {manilaTime(u.createdAt)}</p>
            </div>
            <p className="font-mono">{u.username}</p>
            <p className="capitalize">{u.role}{u.active ? "" : " · off"}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn" disabled={busy} onClick={() => reset(u)}>
                Reset password
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(u.role === "owner" ? `${u.name} is now Staff.` : `${u.name} is now an Owner.`, () => api(`/api/users/${u.id}`, "PATCH", { role: u.role === "owner" ? "staff" : "owner" }))}>
                {u.role === "owner" ? "Make Staff" : "Make Owner"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(u.active ? `${u.name} is deactivated.` : `${u.name} is active again.`, () => api(`/api/users/${u.id}`, "PATCH", { active: !u.active }))}>
                {u.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {users && users.length === 0 && <p className="text-sm text-muted">No accounts yet.</p>}
    </main>
  );
}
```

`components/change-password.tsx`:
```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setMessage({ kind: "error", text: "The new passwords do not match." });
    try {
      await api("/api/me/password", "PUT", { current, next });
      setCurrent("");
      setNext("");
      setAgain("");
      setMessage({ kind: "ok", text: "Password changed." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Change password
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-line bg-card p-3 text-sm">
      <label className="space-y-1">
        <span className="block text-muted">Current password</span>
        <input className="field" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">New password</span>
        <input className="field" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">New password again</span>
        <input className="field" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary h-10">
        Save
      </button>
      <button type="button" className="btn h-10" onClick={() => setOpen(false)}>
        Close
      </button>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`w-full ${message.kind === "error" ? "text-danger" : ""}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Header, tracker, balances, voucher page**

`components/tracker.tsx`: `State` gains `me: SessionUser` (type from `@/lib/users`); pass `me={state.me}` to `Header`.

`components/header.tsx`: props gain `me: SessionUser`. In the top row, before the Vouchers link: `<span className="text-sm text-muted">{me.name}</span>`; after it, `{me.role === "owner" && <Link href="/users" className="btn">Users</Link>}`; and after the Sign out form, `{me.id !== "shared" && <ChangePassword />}` (import from `./change-password`).

`components/balances.tsx`: where it prints `entered {manilaTime(c.updatedAt!)}`, append `{c.updatedBy ? ` by ${c.updatedBy}` : ""}`.

`components/voucher-editor.tsx`: under the cheque line in the editor section, add
```tsx
        <p className="text-xs text-muted">
          Made by {v.createdBy ?? "unknown"}
          {v.updatedBy ? ` · last saved by ${v.updatedBy}` : ""}
        </p>
```

- [ ] **Step 3: Typecheck, test, build, local check**

Run: `npm.cmd run typecheck`, `npm.cmd test`, build into `.next-check` — all clean; `/users` listed.

Local check (dev server, log outside the project; its PGlite database has no users, and `.env.development` sets `ADMIN_PASSWORD=admin`):
1. `/login` shows username and password. Sign in as `owner` / `admin`. The header shows "Owner (shared password)" and a Users link; the Users page shows the shared-password warning.
2. Add an Owner (made-up name, username, password). Sign out. `owner` / `admin` is now refused with "Wrong username or password." Sign in as the new Owner.
3. Add a Staff user. Open a second tab, sign in as Staff there: no Users link; `/users` says Owners only; `/api/users` is 403.
4. As Owner, deactivate the Staff user. In the Staff tab, the next refresh shows the sign-in page.
5. Reactivate, reset the Staff password; sign in as Staff with the new one; change the password from the header; sign out and in with the changed one.
6. Try to deactivate the only Owner: "There must be at least one active Owner."
7. Enter a balance as Owner: the Bank balances section shows "entered … by <name>". Make a voucher: "Prepared by" is pre-filled and the page says "Made by <name>".
8. Ten wrong passwords for one username: the eleventh says "Too many wrong passwords".

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(users): sign-in by username, Users page for Owners, change password, names on balances and vouchers"
```

---

### Task 6: Docs, review, go-live

- [ ] **Step 1: README**

Replace the sign-in sentences in README ("sign in with `admin`") with: locally, sign in as `owner` with password `admin` until you create an account. Add a "Users" section: roles, the shared password rule, how to add people, reset passwords, deactivate, the last-Owner rule, and that `ADMIN_PASSWORD` can be removed from Vercel after the first Owner exists (keep `SESSION_SECRET`).

- [ ] **Step 2: Independent review**

Dispatch a fresh reviewer on the branch with the spec, the plan's Review Focus and the ledger's rulings. Fix Critical and Important findings test-first; ledger the rest.

- [ ] **Step 3: Go live, in order**

1. `npm.cmd run migrate` against production — expected `005_users.sql`.
2. Merge to `main`, push, wait for the deploy; check `GET /login` is 200 and `GET /api/users` without a session is 401.
3. Tell the owner: everyone is signed out; sign in as `owner` with the shared password, create your Owner account under Users, sign out, sign in as yourself; then add staff. Ask them to confirm the shared password is refused afterwards.
