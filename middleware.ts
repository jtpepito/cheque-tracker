import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Every page and API route needs a valid session except /login and /api/sync (the sheet's
// script, which proves itself with the sync key instead; see app/api/sync).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/sync") return NextResponse.next();

  const authed = !!(await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value));

  // The sign-in page is always reachable. A cookie can carry a valid signature for a person who
  // was since deactivated (or for the shared owner once an account exists); sending such a
  // visitor away from /login would bounce them between the page and the sign-in forever.
  if (pathname === "/login") return NextResponse.next();
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
    return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
