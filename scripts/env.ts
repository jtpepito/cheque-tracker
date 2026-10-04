import fs from "node:fs";
import path from "node:path";
import { migrate } from "../lib/migrate";
import type { Sql } from "../lib/sql";

/** A setting from the environment, else from .env.production.local. Never printed. */
function setting(name: string): string | null {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(process.cwd(), ".env.production.local");
  if (!fs.existsSync(file)) return null;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || null : null;
}

/** The real database, or with --local the development one in data/pglite (stop the dev server first). */
export async function openTarget(local: boolean): Promise<{ sql: Sql; label: string }> {
  if (local) {
    const { pgliteSql } = await import("../lib/sql-pglite");
    const sql = await pgliteSql(path.join(process.cwd(), "data", "pglite"));
    await migrate(sql);
    return { sql, label: "local development database (data/pglite)" };
  }
  const url = setting("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL is not set. Put it in .env.production.local, or use --local.");
  const ca = setting("DATABASE_CA_CERT") ?? undefined;
  const { pgSql } = await import("../lib/sql-pg");
  return { sql: pgSql(url, ca), label: `database at ${new URL(url).hostname}${ca ? " (server verified)" : " (server NOT verified)"}` };
}
