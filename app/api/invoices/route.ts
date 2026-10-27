import { NextResponse } from "next/server";
import { listCheques } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded } from "@/lib/http";
import { invoicesForCheque } from "@/lib/invoices";
import { TRADING, type Trading } from "@/lib/projection";

export const dynamic = "force-dynamic";

// The sheet's invoices that a cheque pays, for the voucher page's "Fill from sheet" button.
export function GET(req: Request) {
  return guarded(async () => {
    const chequeId = new URL(req.url).searchParams.get("chequeId") ?? "";
    const sql = await getSql();
    const cheque = (await listCheques(sql)).find((c) => c.id === chequeId);
    if (!cheque) return badRequest("This cheque no longer exists.");
    if (!TRADING.includes(cheque.company as Trading)) return badRequest("Choose a company for this cheque first.");
    return NextResponse.json(await invoicesForCheque(sql, cheque.company as Trading, cheque.chequeNo));
  });
}
