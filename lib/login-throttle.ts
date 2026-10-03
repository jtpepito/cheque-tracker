import type { Sql } from "./sql";

// Sign-in attempts are counted in the database, because Vercel runs many function instances
// that do not share memory. The attempt is recorded first and counted second, so a burst of
// attempts sent at once cannot all slip past the limit.

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

/** Records this attempt and says whether it may go ahead: at most ten per address per window. */
export async function allowAttempt(sql: Sql, who: string, now: number = Date.now()): Promise<boolean> {
  await sql.query("DELETE FROM login_failures WHERE at <= $1", [now - WINDOW_MS]);
  // One statement records the attempt and counts the earlier ones (the count does not see the
  // row being inserted, hence the + 1), so attempts are numbered in the order they arrive.
  const rows = await sql.query<{ n: unknown }>(
    `WITH attempt AS (INSERT INTO login_failures (who, at) VALUES ($1, $2) RETURNING 1)
     SELECT (SELECT count(*) FROM login_failures WHERE who = $1 AND at > $3) + (SELECT count(*) FROM attempt) AS n`,
    [who, now, now - WINDOW_MS],
  );
  return Number(rows[0].n) <= MAX_FAILURES;
}

/** After a correct password. */
export async function clearAttempts(sql: Sql, who: string): Promise<void> {
  await sql.query("DELETE FROM login_failures WHERE who = $1", [who]);
}
