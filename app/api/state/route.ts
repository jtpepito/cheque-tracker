import { NextResponse } from "next/server";
import { getCompanyNames, listCheques, listHolidays } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(() => {
    const db = getDb();
    return NextResponse.json(
      { today: todayManila(), companies: getCompanyNames(db), holidays: listHolidays(db), cheques: listCheques(db) },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
