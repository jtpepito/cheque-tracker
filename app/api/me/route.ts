import { NextResponse } from "next/server";
import { guarded } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded((user) => NextResponse.json(user));
}
