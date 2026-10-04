import { NextResponse } from "next/server";
import { setBalance } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { parseBalance } from "@/lib/money";
import { TRADING, type Trading } from "@/lib/projection";

// A company's bank balance, typed in by someone who has just checked the bank.
export function PUT(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    if (!TRADING.includes(body.company as Trading)) return badRequest("Choose one of the three companies.");
    const amount = parseBalance(body.amount);
    if (amount === null) return badRequest("Enter the balance as a number, for example 1,250,000.50.");
    return NextResponse.json(await setBalance(await getSql(), body.company as Trading, amount));
  });
}
