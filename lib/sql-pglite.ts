import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./sql";

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (text: string) => Promise<unknown> };

function wrap(run: Runner, tx: Sql["tx"]): Sql {
  return {
    query: async <T>(text: string, params?: unknown[]) => (await run.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await run.exec(text);
    },
    tx,
  };
}

/** In-process Postgres. No dataDir: in memory (tests). With one: kept on disk (local development). */
export async function pgliteSql(dataDir?: string): Promise<Sql> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  return wrap(db as unknown as Runner, (fn) =>
    db.transaction(async (t) => {
      const inner: Sql = wrap(t as unknown as Runner, (f) => f(inner));
      return fn(inner);
    }) as Promise<never>,
  );
}
