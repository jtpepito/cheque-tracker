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
