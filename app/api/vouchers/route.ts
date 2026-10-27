import { NextResponse } from "next/server";
import { todayManila } from "@/lib/dates";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { createVoucherForCheque, listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () => NextResponse.json(await listVouchers(await getSql())));
}

export function POST(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body || typeof body.chequeId !== "string") return badRequest("The request was not understood.");
    return NextResponse.json(await createVoucherForCheque(await getSql(), body.chequeId, todayManila()));
  });
}
