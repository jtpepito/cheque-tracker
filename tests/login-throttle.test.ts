import { beforeEach, describe, expect, it } from "vitest";
import { clearFailures, isBlocked, MAX_FAILURES, recordFailure, WINDOW_MS } from "@/lib/login-throttle";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const failTimes = async (who: string, times: number, at: number) => {
  for (let i = 0; i < times; i++) await recordFailure(sql, who, at + i);
};

describe("sign-in lockout", () => {
  it("blocks an address after ten wrong passwords inside the window, and only that address", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES - 1, 1000);
    expect(await isBlocked(sql, "1.1.1.1", 2000)).toBe(false);
    await recordFailure(sql, "1.1.1.1", 2000);
    expect(await isBlocked(sql, "1.1.1.1", 3000)).toBe(true);
    expect(await isBlocked(sql, "2.2.2.2", 3000)).toBe(false);
  });

  it("lets the address try again once the window has passed", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES, 1000);
    expect(await isBlocked(sql, "1.1.1.1", 1000 + WINDOW_MS - 1)).toBe(true);
    expect(await isBlocked(sql, "1.1.1.1", 1000 + MAX_FAILURES + WINDOW_MS)).toBe(false);
  });

  it("forgets failures after a correct password", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES, 1000);
    await clearFailures(sql, "1.1.1.1");
    expect(await isBlocked(sql, "1.1.1.1", 2000)).toBe(false);
  });

  it("clears out old failures as new ones are recorded", async () => {
    await failTimes("1.1.1.1", 3, 1000);
    await recordFailure(sql, "2.2.2.2", 1000 + WINDOW_MS + 5000);
    expect(await sql.query("SELECT 1 FROM login_failures WHERE who = $1", ["1.1.1.1"])).toEqual([]);
  });
});
