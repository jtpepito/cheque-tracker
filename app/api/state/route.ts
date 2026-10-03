import { NextResponse } from "next/server";
import { getCompanyNames, listCheques, listHolidays } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getSql } from "@/lib/db";
import { guarded } from "@/lib/http";
import { getLastRefusal, getLastSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () => {
    const sql = await getSql();
    const [companies, holidays, sync, refusal, cheques] = await Promise.all([
      getCompanyNames(sql),
      listHolidays(sql),
      getLastSync(sql),
      getLastRefusal(sql),
      listCheques(sql),
    ]);
    return NextResponse.json(
      { today: todayManila(), now: Date.now(), companies, holidays, sync, refusal, cheques },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
