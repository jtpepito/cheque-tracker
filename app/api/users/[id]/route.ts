import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { getUser, setUserActive, setUserRole } from "@/lib/users";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerOnly(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const sql = await getSql();
    if (typeof body.active === "boolean") await setUserActive(sql, id, body.active);
    if (body.role === "owner" || body.role === "staff") await setUserRole(sql, id, body.role);
    const user = await getUser(sql, id);
    return user ? NextResponse.json(user) : NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  });
}
