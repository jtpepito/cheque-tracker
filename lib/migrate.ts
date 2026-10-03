import fs from "node:fs";
import path from "node:path";
import { PH_HOLIDAYS_2026 } from "./banking";
import type { Sql } from "./sql";

export async function seedHolidays(sql: Sql): Promise<void> {
  for (const h of PH_HOLIDAYS_2026) {
    await sql.query("INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING", [h.date, h.name]);
  }
}

/** Applies migration files not yet applied, in name order. Returns the names it applied. */
export async function migrate(sql: Sql, dir: string = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  await sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at bigint NOT NULL)");
  await sql.exec("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY");
  const done = new Set((await sql.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    await sql.tx(async (t) => {
      await t.exec(text);
      await t.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [name, Date.now()]);
      // The national holidays are seeded with the first migration only, so one removed in the page stays removed.
      if (name === "001_init.sql") await seedHolidays(t);
    });
    applied.push(name);
  }
  return applied;
}
