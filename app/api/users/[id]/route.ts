import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { getUser, setUserActive, setUserRole } from "@/lib/users";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerOnly(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const activeOk = typeof body.active === "boolean";
    const roleOk = body.role === "owner" || body.role === "staff";
    if (!activeOk && !roleOk) return badRequest("Send active (true or false) or role (owner or staff).");
    const sql = await getSql();
    if (activeOk) await setUserActive(sql, id, body.active as boolean);
    if (roleOk) await setUserRole(sql, id, body.role as "owner" | "staff");
    const user = await getUser(sql, id);
    return user ? NextResponse.json(user) : NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
  });
}
