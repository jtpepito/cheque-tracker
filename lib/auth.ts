import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** Re-checks the session inside route handlers. Middleware already gates every request. */
export async function isSignedIn(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Mark cookies Secure when the request came over HTTPS (Vercel), not on plain-HTTP localhost. */
export async function cookieSecure(): Promise<boolean> {
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (h.get("origin") ?? "").startsWith("https://");
}
