import { Pool, type PoolClient } from "pg";
import { pgConfig } from "./pg-config";
import type { Sql } from "./sql";

/** Postgres over the network (Supabase's transaction pooler). */
export function pgSql(url: string, caCert: string | undefined = process.env.DATABASE_CA_CERT): Sql {
  const pool = new Pool(pgConfig(url, caCert));
  // An idle connection can be dropped while a serverless function is frozen. Without a listener
  // that error would crash the process; the pool simply opens a new connection next time.
  pool.on("error", (err) => console.error("[db] idle connection error:", err.message));

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
