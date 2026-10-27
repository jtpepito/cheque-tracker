import "server-only";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { ChequeError } from "./cheques";
import { getSql } from "./db";
import type { SessionUser } from "./users";
import { UserError } from "./users";
import { VoucherError } from "./vouchers";

type Handler = (user: SessionUser) => Promise<NextResponse> | NextResponse;

const unauthorized = () => NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });

/** Checks the session against the database, runs the handler, and turns known errors into JSON. */
export async function guarded(handler: Handler): Promise<NextResponse> {
  let user: SessionUser | null;
  try {
    user = await currentUser(await getSql());
  } catch (err) {
    console.error("[api] session check failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  if (!user) return unauthorized();
  try {
    return await handler(user);
  } catch (err) {
    if (err instanceof ChequeError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof VoucherError) {
      const status = err.code === "not_found" ? 404 : err.code === "unassigned" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    if (err instanceof UserError) {
      const status = err.code === "not_found" ? 404 : err.code === "invalid" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[api] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

/** As guarded, for Owners only. */
export function ownerOnly(handler: Handler): Promise<NextResponse> {
  return guarded((user) => (user.role === "owner" ? handler(user) : NextResponse.json({ error: "Owners only." }, { status: 403 })));
}

export const badRequest = (error: string, errors?: Record<string, string>) =>
  NextResponse.json({ error, errors }, { status: 400 });

/** The request body as a plain object, or null when it is not a JSON object. */
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
