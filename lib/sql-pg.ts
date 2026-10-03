import { Pool, type PoolClient } from "pg";
import type { Sql } from "./sql";

/** Postgres over the network (Supabase's transaction pooler). */
export function pgSql(url: string): Sql {
  // Supabase's pooler certificate is not in Node's default trust store.
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, ssl: { rejectUnauthorized: false } });
  const on = (run: Pool | PoolClient, tx: Sql["tx"]): Sql => ({
    query: async <T>(text: string, params?: unknown[]) => (await run.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await run.query(text);
    },
    tx,
  });
  return on(pool, async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inner: Sql = on(client, (f) => f(inner));
      const out = await fn(inner);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Keep the original error.
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
