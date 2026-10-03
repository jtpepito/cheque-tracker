import { NextResponse } from "next/server";
import { setCompany } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { isCompany } from "@/lib/types";

// Status comes only from the sheet; the page can change a cheque's company and nothing else.
export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    if (!isCompany(body.company)) return badRequest("Unknown company.");
    return NextResponse.json(setCompany(getDb(), id, body.company));
  });
}
