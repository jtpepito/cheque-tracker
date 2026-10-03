import { migrate, seedHolidays } from "@/lib/migrate";
import type { Sql } from "@/lib/sql";
import { pgliteSql } from "@/lib/sql-pglite";

let shared: Promise<Sql> | undefined;

/** One in-memory Postgres per test file (starting one takes a moment); call resetDb before each test. */
export function testSql(): Promise<Sql> {
  shared ??= (async () => {
    const sql = await pgliteSql();
    await migrate(sql);
    return sql;
  })();
  return shared;
}

export async function resetDb(sql: Sql): Promise<void> {
  await sql.exec("TRUNCATE cheques, config, holidays, login_failures");
  await seedHolidays(sql);
}
