// HMAC-signed session cookie. Uses Web Crypto so the same code runs in middleware (edge
// runtime) and in route handlers (Node).

// Browsers share cookies across localhost ports, so the dev server uses its own name.
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

/** Cookie value: "<expiry-unix-seconds>.<hmac>". */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD is not set");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(key, `session:${exp}`)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp < now / 1000) return false;
  return safeEqual(sig, await hmac(key, `session:${exp}`));
}

export function checkPassword(attempt: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(attempt, expected);
}
