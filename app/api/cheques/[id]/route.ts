import { NextResponse } from "next/server";
import { setCompany, setStatus } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { isCompany, isStatus } from "@/lib/types";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    if ("status" in body) {
      if (!isStatus(body.status)) return badRequest("Unknown status.");
      return NextResponse.json(setStatus(getDb(), id, body.status));
    }
    if ("company" in body) {
      if (!isCompany(body.company)) return badRequest("Unknown company.");
      return NextResponse.json(setCompany(getDb(), id, body.company));
    }
    return badRequest("Nothing to change.");
  });
}
