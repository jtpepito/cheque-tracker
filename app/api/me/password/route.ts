import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieSecure } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";
import { changeOwnPassword, SHARED_OWNER } from "@/lib/users";

export function PUT(req: Request) {
  return guarded(async (user) => {
    if (user.id === SHARED_OWNER.id) return badRequest("Create your own account first; the shared password is set on the server.");
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const version = await changeOwnPassword(await getSql(), user.id, body.current, body.next);
    // Every other session just ended; keep this one going with the new version.
    (await cookies()).set(SESSION_COOKIE, await createSessionToken(user.id, version), {
      httpOnly: true,
      sameSite: "lax",
      secure: await cookieSecure(),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return NextResponse.json({});
  });
}
