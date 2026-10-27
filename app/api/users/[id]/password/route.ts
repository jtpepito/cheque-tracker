import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, ownerOnly, readObject } from "@/lib/http";
import { resetPassword } from "@/lib/users";

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ownerOnly(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    return NextResponse.json(await resetPassword(await getSql(), id, body.next));
  });
}
