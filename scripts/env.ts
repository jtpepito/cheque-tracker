import fs from "node:fs";
import path from "node:path";
import { migrate } from "../lib/migrate";
import type { Sql } from "../lib/sql";

/** DATABASE_URL from the environment, else from .env.production.local. Never printed. */
function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(process.cwd(), ".env.production.local");
  if (!fs.existsSync(file)) return null;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  return line ? line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") || null : null;
}

/** The real database, or with --local the development one in data/pglite (stop the dev server first). */
export async function openTarget(local: boolean): Promise<{ sql: Sql; label: string }> {
  if (local) {
    const { pgliteSql } = await import("../lib/sql-pglite");
    const sql = await pgliteSql(path.join(process.cwd(), "data", "pglite"));
    await migrate(sql);
    return { sql, label: "local development database (data/pglite)" };
  }
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set. Put it in .env.production.local, or use --local.");
  const { pgSql } = await import("../lib/sql-pg");
  return { sql: pgSql(url), label: `database at ${new URL(url).hostname}` };
}
