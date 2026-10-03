import { beforeEach, describe, expect, it } from "vitest";
import { allowAttempt, clearAttempts, MAX_FAILURES, WINDOW_MS } from "@/lib/login-throttle";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const attempts = async (who: string, times: number, at: number) => {
  const results: boolean[] = [];
  for (let i = 0; i < times; i++) results.push(await allowAttempt(sql, who, at + i));
  return results;
};

describe("sign-in lockout", () => {
  it("allows ten attempts from an address inside the window and refuses the eleventh", async () => {
    expect(await attempts("1.1.1.1", MAX_FAILURES, 1000)).toEqual(Array(MAX_FAILURES).fill(true));
    expect(await allowAttempt(sql, "1.1.1.1", 2000)).toBe(false);
    expect(await allowAttempt(sql, "2.2.2.2", 2000)).toBe(true);
  });

  it("counts attempts made at the same moment, so a burst cannot slip past", async () => {
    const burst = await Promise.all(Array.from({ length: MAX_FAILURES + 5 }, () => allowAttempt(sql, "1.1.1.1", 1000)));
    expect(burst.filter(Boolean)).toHaveLength(MAX_FAILURES);
  });

  it("lets the address try again once the window has passed", async () => {
    await attempts("1.1.1.1", MAX_FAILURES, 1000);
    expect(await allowAttempt(sql, "1.1.1.1", 1000 + MAX_FAILURES + WINDOW_MS + 1)).toBe(true);
  });

  it("forgets the attempts after a correct password", async () => {
    await attempts("1.1.1.1", MAX_FAILURES, 1000);
    await clearAttempts(sql, "1.1.1.1");
    expect(await allowAttempt(sql, "1.1.1.1", 2000)).toBe(true);
  });

  it("clears out old attempts as new ones are recorded", async () => {
    await attempts("1.1.1.1", 3, 1000);
    await allowAttempt(sql, "2.2.2.2", 1000 + WINDOW_MS + 5000);
    expect(await sql.query("SELECT 1 FROM login_failures WHERE who = $1", ["1.1.1.1"])).toEqual([]);
  });
});
