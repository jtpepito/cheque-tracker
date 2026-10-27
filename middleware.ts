import { NextResponse, type NextRequest } from "next/server";
import { newNonce, securityHeaders } from "@/lib/csp";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Every page and API route needs a valid session except /login and /api/sync (the sheet's
// script, which proves itself with the sync key instead; see app/api/sync). Every response
// carries the security headers; the page's own scripts get this request's nonce.
export async function middleware(req: NextRequest) {
  const nonce = newNonce();
  const headers = securityHeaders(nonce, process.env.NODE_ENV === "development");
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", headers["Content-Security-Policy"]);
  const send = (res: NextResponse) => {
    for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
    return res;
  };
  const pass = () => send(NextResponse.next({ request: { headers: reqHeaders } }));

  const { pathname } = req.nextUrl;
  if (pathname === "/api/sync") return pass();

  const authed = !!(await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value));

  // The sign-in page is always reachable. A cookie can carry a valid signature for a person who
  // was since deactivated (or for the shared owner once an account exists); sending such a
  // visitor away from /login would bounce them between the page and the sign-in forever.
  if (pathname === "/login") return pass();
  if (authed) return pass();

  if (pathname.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
    return send(NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 }));
  }
  return send(NextResponse.redirect(new URL("/login", req.url)));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
