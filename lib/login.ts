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
