import type { Sql } from "./sql";

// Wrong passwords are counted in the database, because Vercel runs many function instances
// that do not share memory.

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

export async function isBlocked(sql: Sql, who: string, now: number = Date.now()): Promise<boolean> {
  const rows = await sql.query<{ n: unknown }>("SELECT count(*) AS n FROM login_failures WHERE who = $1 AND at > $2", [
    who,
    now - WINDOW_MS,
  ]);
  return Number(rows[0].n) >= MAX_FAILURES;
}

export async function recordFailure(sql: Sql, who: string, now: number = Date.now()): Promise<void> {
  await sql.query("DELETE FROM login_failures WHERE at <= $1", [now - WINDOW_MS]);
  await sql.query("INSERT INTO login_failures (who, at) VALUES ($1, $2)", [who, now]);
}

export async function clearFailures(sql: Sql, who: string): Promise<void> {
  await sql.query("DELETE FROM login_failures WHERE who = $1", [who]);
}
