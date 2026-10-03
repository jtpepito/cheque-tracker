import { NextResponse } from "next/server";
import { createCheque } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { validateNewCheque } from "@/lib/validate";

export function POST(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const v = validateNewCheque(body);
    if (!v.ok) return badRequest("Fix the highlighted fields.", v.errors);
    return NextResponse.json(createCheque(getDb(), v.value), { status: 201 });
  });
}
