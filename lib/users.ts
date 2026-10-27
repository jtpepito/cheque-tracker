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

/**
 * Refuses a change that would leave no active Owner. Runs inside the caller's transaction and
 * locks the active Owner rows first, so two Owners removing each other at the same moment
 * cannot both pass the count.
 */
async function guardLastOwner(tx: Sql, user: User): Promise<void> {
  if (user.role !== "owner" || !user.active) return;
  await tx.query("SELECT id FROM users WHERE role = 'owner' AND active FOR UPDATE");
  if ((await countActiveOwners(tx)) <= 1) throw new UserError("last_owner", "There must be at least one active Owner.");
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
  return sql.tx(async (tx) => {
    const user = await mustGet(tx, id);
    if (!active && user.active) await guardLastOwner(tx, user);
    // Deactivating ends every session the person has; reactivating does not revive them.
    const bump = !active && user.active ? ", session_version = session_version + 1" : "";
    await tx.query(`UPDATE users SET active = $2, updated_at = $3${bump} WHERE id = $1`, [id, active, now]);
    return (await getUser(tx, id))!;
  });
}

export async function setUserRole(sql: Sql, id: string, role: Role, now: number = Date.now()): Promise<User> {
  return sql.tx(async (tx) => {
    const user = await mustGet(tx, id);
    if (role === "staff" && user.role === "owner") await guardLastOwner(tx, user);
    await tx.query("UPDATE users SET role = $2, updated_at = $3 WHERE id = $1", [id, role, now]);
    return (await getUser(tx, id))!;
  });
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

/** Ends every session the person has (sign-out everywhere). Their next request must sign in again. */
export async function endSessions(sql: Sql, id: string): Promise<void> {
  await sql.query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [id]);
}

/**
 * By the person themselves, proving the current password. Every session they have ends, so a
 * cookie copied from another machine stops working; the caller re-issues the current one with
 * the version returned.
 */
export async function changeOwnPassword(sql: Sql, id: string, current: unknown, next: unknown, now: number = Date.now()): Promise<number> {
  const problem = passwordProblem(next);
  if (problem) throw new UserError("invalid", problem);
  const row = (await sql.query<Row>("SELECT password_hash FROM users WHERE id = $1 AND active", [id]))[0];
  if (!row) throw new UserError("not_found", "That user no longer exists.");
  if (typeof current !== "string" || !checkPasswordHash(current, row.password_hash as string)) {
    throw new UserError("invalid", "Current password: that is not your current password.");
  }
  const rows = await sql.query<{ session_version: unknown }>(
    "UPDATE users SET password_hash = $2, session_version = session_version + 1, updated_at = $3 WHERE id = $1 RETURNING session_version",
    [id, hashPassword(next as string), now],
  );
  return Number(rows[0].session_version);
}
