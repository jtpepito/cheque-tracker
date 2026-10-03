import "server-only";
import { NextResponse } from "next/server";
import { isSignedIn } from "./auth";
import { ChequeError } from "./cheques";

type Handler = () => Promise<NextResponse> | NextResponse;

/** Checks the session, runs the handler, and turns known errors into JSON responses. */
export async function guarded(handler: Handler): Promise<NextResponse> {
  if (!(await isSignedIn())) {
    return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
  try {
    return await handler();
  } catch (err) {
    if (err instanceof ChequeError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[api] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
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
