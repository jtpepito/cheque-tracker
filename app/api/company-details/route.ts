import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { setCompanyDetails, type CompanyDetails } from "@/lib/vouchers";

export function PUT(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    return NextResponse.json(await setCompanyDetails(await getSql(), body as CompanyDetails));
  });
}
