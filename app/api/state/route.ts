import { NextResponse } from "next/server";
import { getCompanyNames, listBalances, listCheques, listHolidays } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getSql } from "@/lib/db";
import { guarded } from "@/lib/http";
import { getLastRefusal, getLastSync } from "@/lib/sync";
import { getCompanyDetails, vouchersByCheque } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async (user) => {
    const sql = await getSql();
    const [companies, holidays, sync, refusal, balances, vouchers, companyDetails, cheques] = await Promise.all([
      getCompanyNames(sql),
      listHolidays(sql),
      getLastSync(sql),
      getLastRefusal(sql),
      listBalances(sql),
      vouchersByCheque(sql),
      getCompanyDetails(sql),
      listCheques(sql),
    ]);
    return NextResponse.json(
      { today: todayManila(), now: Date.now(), me: user, companies, holidays, sync, refusal, balances, vouchers, companyDetails, cheques },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
