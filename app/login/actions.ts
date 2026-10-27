"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSecure } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { signIn } from "@/lib/login";
import { allowAttempt, clearAttempts } from "@/lib/login-throttle";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";
import { normalizeUsername } from "@/lib/passwords";
import { endSessions, SHARED_OWNER } from "@/lib/users";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const username = normalizeUsername(fd.get("username"));
  const password = String(fd.get("password") ?? "");
  let outcome: Awaited<ReturnType<typeof signIn>>;
  try {
    const sql = await getSql();
    // At most ten attempts in 15 minutes per address, and per username from that address,
    // counted before the password is looked at, so a burst sent at once cannot slip past. The
    // username bucket is tied to the address so a stranger cannot lock someone else out.
    const userKey = `user:${ip}:${username}`;
    const allowed = (await allowAttempt(sql, `ip:${ip}`)) && (await allowAttempt(sql, userKey));
    if (!allowed) return { error: "Too many wrong passwords. Try again in 15 minutes." };
    outcome = await signIn(sql, username, password);
    if (outcome.ok) {
      await clearAttempts(sql, `ip:${ip}`);
      await clearAttempts(sql, userKey);
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

/** Signs the person out everywhere: the cookie goes, and the token it held stops verifying. */
export async function logout() {
  const jar = await cookies();
  const token = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (token && token.userId !== SHARED_OWNER.id) {
    try {
      await endSessions(await getSql(), token.userId);
    } catch (err) {
      console.error("[logout] database error:", err instanceof Error ? err.message : err);
    }
  }
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
