// HMAC-signed session cookie. Uses Web Crypto so the same code runs in middleware (edge
// runtime) and in route handlers (Node). The cookie says who is signed in and which session
// version they had; whether that is still valid is checked against the database by the routes.

export const SESSION_COOKIE = process.env.NODE_ENV === "development" ? "cheques_dev_session" : "cheques_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export type SessionToken = { userId: string; version: number };

/** Cookie value: "<expiry-unix-seconds>.<user id>.<version>.<hmac>". */
export async function createSessionToken(userId: string, version: number, now = Date.now()): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not set");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${userId}.${version}.${await hmac(key, `session:${exp}:${userId}:${version}`)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<SessionToken | null> {
  const key = secret();
  if (!key || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [expStr, userId, versionStr, sig] = parts;
  const exp = Number(expStr);
  const version = Number(versionStr);
  if (!Number.isInteger(exp) || !Number.isInteger(version) || !userId || !sig || exp < now / 1000) return null;
  return safeEqual(sig, await hmac(key, `session:${exp}:${userId}:${version}`)) ? { userId, version } : null;
}

/** The shared password, used only until the first Owner account exists. */
export function checkPassword(attempt: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(attempt, expected);
}
