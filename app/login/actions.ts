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
