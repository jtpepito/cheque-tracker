"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSecure } from "@/lib/auth";
import { createThrottle } from "@/lib/throttle";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

// Ten wrong passwords from one address lock that address out for 15 minutes.
const throttle = createThrottle(10, 15 * 60 * 1000);

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  if (!process.env.ADMIN_PASSWORD) {
    return { error: "ADMIN_PASSWORD is not set on the server. Add it to the environment and restart." };
  }
  const h = await headers();
  const who = h.get("fly-client-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (throttle.blocked(who)) return { error: "Too many wrong passwords. Try again in 15 minutes." };
  if (!checkPassword(String(fd.get("password") ?? ""))) {
    throttle.fail(who);
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Wrong password." };
  }
  throttle.reset(who);
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
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
