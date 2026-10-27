import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords are stored as scrypt hashes with a random salt: "scrypt$<salt hex>$<hash hex>".

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_BYTES, PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function checkPasswordHash(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_BYTES) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, "hex"), KEY_BYTES, PARAMS);
  return timingSafeEqual(hash, expected);
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
