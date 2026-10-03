import { NextResponse } from "next/server";
import { getCompanyNames, listCheques, listHolidays } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/http";
import { getLastSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(() => {
    const db = getDb();
    return NextResponse.json(
      {
        today: todayManila(),
        now: Date.now(),
        companies: getCompanyNames(db),
        holidays: listHolidays(db),
        sync: getLastSync(db),
        cheques: listCheques(db),
      },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
