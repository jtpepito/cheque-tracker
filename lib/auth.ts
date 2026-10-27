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
