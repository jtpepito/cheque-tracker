import { NextResponse } from "next/server";
import { setCompanyNames } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import type { CompanyNames } from "@/lib/types";

const KEYS = ["wwj", "wythlae", "wwjcorp"] as const;

export function PUT(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const names = {} as CompanyNames;
    for (const key of KEYS) {
      const raw = body[key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value || value.length > 60) return badRequest("Each company needs a name of up to 60 characters.");
      names[key] = value;
    }
    return NextResponse.json(await setCompanyNames(await getSql(), names));
  });
}
