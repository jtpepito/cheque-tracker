import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { applySync, parsePayload, recordRefusal, SyncRefused } from "@/lib/sync";
import { checkSyncKey } from "@/lib/sync-key";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

// Called by the script in the Google Sheet, not by the page: it carries a key, not a session.
export async function POST(req: Request) {
  const key = checkSyncKey(req.headers.get("authorization"));
  if (key === "unset") return refuse(503, "Sync is not set up.");
  if (key === "wrong") return refuse(401, "Wrong sync key.");

  const text = await req.text();
  if (text.length > MAX_BYTES) return refuse(400, "The sync is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "The sync was not understood.");
  }
  const payload = parsePayload(body);
  if (!payload) return refuse(400, "The sync was not understood.");

  try {
    return NextResponse.json(await applySync(await getSql(), payload));
  } catch (err) {
    if (err instanceof SyncRefused) {
      if (!payload.dryRun) await recordRefusal(await getSql(), err.message);
      return refuse(err.status, err.message);
    }
    console.error("[sync] failed:", err);
    return refuse(500, "The sync failed. Nothing was changed.");
  }
}
