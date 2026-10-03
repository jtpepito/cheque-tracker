import "server-only";
import path from "node:path";
import type { Sql } from "./sql";
import { chooseStorage } from "./storage";

// One database handle per server process. Kept on globalThis so dev-mode hot reloads reuse it.
const globalForDb = globalThis as unknown as { __chequesSql?: Promise<Sql> };

async function open(): Promise<Sql> {
  if (chooseStorage(process.env) === "pg") {
    const { pgSql } = await import("./sql-pg");
    return pgSql(process.env.DATABASE_URL!);
  }
  // Local development: an in-process Postgres kept in data/pglite, with its tables made on first use.
  const { pgliteSql } = await import("./sql-pglite");
  const { migrate } = await import("./migrate");
  const sql = await pgliteSql(path.join(process.cwd(), "data", "pglite"));
  await migrate(sql);
  return sql;
}

export function getSql(): Promise<Sql> {
  globalForDb.__chequesSql ??= open().catch((err) => {
    globalForDb.__chequesSql = undefined;
    throw err;
  });
  return globalForDb.__chequesSql;
}
