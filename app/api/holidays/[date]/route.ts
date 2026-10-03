import { NextResponse } from "next/server";
import { removeHoliday } from "@/lib/cheques";
import { isValidDate } from "@/lib/dates";
import { getSql } from "@/lib/db";
import { badRequest, guarded } from "@/lib/http";

export function DELETE(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  return guarded(async () => {
    const { date } = await params;
    if (!isValidDate(date)) return badRequest("Unknown date.");
    await removeHoliday(await getSql(), date);
    return NextResponse.json({ date });
  });
}
