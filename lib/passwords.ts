import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords are stored as scrypt hashes with a random salt: "scrypt$<N>$<salt hex>$<hash hex>".
// Hashes made before the work factor was recorded ("scrypt$<salt>$<hash>") used N = 16384.

const N = 65536; // 2^16, about 64 MB and a few hundred milliseconds per check
const R = 8;
const P = 1;
const LEGACY_N = 16384;
const KEY_BYTES = 64;
const derive = (password: string, salt: Buffer, n: number) =>
  scryptSync(password, salt, KEY_BYTES, { N: n, r: R, p: P, maxmem: 256 * n * R });

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString("hex")}$${derive(password, salt, N).toString("hex")}`;
}

export function checkPasswordHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt" || (parts.length !== 3 && parts.length !== 4)) return false;
  const n = parts.length === 4 ? Number(parts[1]) : LEGACY_N;
  const [saltHex, hashHex] = parts.slice(-2);
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20 || (n & (n - 1)) !== 0 || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_BYTES) return false;
  return timingSafeEqual(derive(password, Buffer.from(saltHex, "hex"), n), expected);
}

export function normalizeUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function usernameProblem(raw: unknown): string | null {
  const u = normalizeUsername(raw);
  return /^[a-z0-9._-]{3,30}$/.test(u) ? null : "Username: 3 to 30 characters, letters, digits, dots, underscores or dashes.";
}

export function passwordProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length < 8) return "Password: at least 8 characters.";
  if (raw.length > 200) return "Password: at most 200 characters.";
  return null;
}
