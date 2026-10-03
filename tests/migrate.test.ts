import { describe, expect, it } from "vitest";
import { PH_HOLIDAYS_2026 } from "@/lib/banking";
import { migrate } from "@/lib/migrate";
import { pgliteSql } from "@/lib/sql-pglite";

describe("migrate", () => {
  it("creates every table, seeds the holidays once, and does nothing the second time", async () => {
    const sql = await pgliteSql();
    expect(await migrate(sql)).toEqual(["001_init.sql"]);
    const tables = await sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual(["cheques", "config", "holidays", "login_failures", "schema_migrations"]);
    const holidays = await sql.query("SELECT date, name FROM holidays ORDER BY date");
    expect(holidays).toEqual(PH_HOLIDAYS_2026);

    await sql.query("DELETE FROM holidays WHERE date = $1", ["2026-12-08"]);
    expect(await migrate(sql)).toEqual([]);
    expect(await sql.query("SELECT 1 FROM holidays WHERE date = $1", ["2026-12-08"])).toEqual([]);
  });

  it("rolls back everything in a transaction that throws, and returns the value of one that does not", async () => {
    const sql = await pgliteSql();
    await migrate(sql);
    await expect(
      sql.tx(async (t) => {
        await t.query("INSERT INTO config (key, value) VALUES ($1, $2)", ["k", "v"]);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await sql.query("SELECT 1 FROM config WHERE key = $1", ["k"])).toEqual([]);
    expect(await sql.tx(async (t) => (await t.query<{ n: number }>("SELECT 7 AS n"))[0].n)).toBe(7);
  });
});
