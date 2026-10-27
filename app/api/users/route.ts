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
