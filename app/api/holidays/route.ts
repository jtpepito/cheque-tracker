import { NextResponse } from "next/server";
import { validateHoliday } from "@/lib/banking";
import { addHoliday } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";

export function POST(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const v = validateHoliday(body);
    if (!v.ok) return badRequest(v.error);
    return NextResponse.json(await addHoliday(await getSql(), v.value), { status: 201 });
  });
}
