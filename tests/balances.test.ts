import { beforeEach, describe, expect, it } from "vitest";
import { listBalances, setBalance } from "@/lib/cheques";
import { parseBalance } from "@/lib/money";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

describe("parseBalance", () => {
  it("reads a balance typed with commas or a peso sign, and allows zero and overdrawn figures", () => {
    expect(parseBalance("1,250,000.50")).toBe(1250000.5);
    expect(parseBalance("₱ 12,500")).toBe(12500);
    expect(parseBalance(0)).toBe(0);
    expect(parseBalance("0")).toBe(0);
    expect(parseBalance("-5,000.25")).toBe(-5000.25);
    expect(parseBalance(1234.567)).toBe(1234.57);
  });
  it("rejects anything that is not an amount, or is absurdly large", () => {
    for (const bad of ["abc", "", " ", "1.2.3", "--5", null, undefined, Number.NaN, Infinity, "1e9", 1e13, "99999999999999"]) {
      expect(parseBalance(bad)).toBeNull();
    }
  });
});

describe("balances store", () => {
  it("starts with no balances", async () => {
    expect(await listBalances(sql)).toEqual([]);
  });

  it("saves a balance per company with the time it was entered, as numbers", async () => {
    expect(await setBalance(sql, "wwj", 1250000.5, 1000)).toEqual({ company: "wwj", amount: 1250000.5, updatedAt: 1000 });
    await setBalance(sql, "wythlae", -300, 2000);
    expect(await listBalances(sql)).toEqual([
      { company: "wwj", amount: 1250000.5, updatedAt: 1000 },
      { company: "wythlae", amount: -300, updatedAt: 2000 },
    ]);
  });

  it("replaces a company's balance when it is entered again", async () => {
    await setBalance(sql, "wwj", 100, 1000);
    await setBalance(sql, "wwj", 250, 5000);
    expect(await listBalances(sql)).toEqual([{ company: "wwj", amount: 250, updatedAt: 5000 }]);
  });

  it("refuses a company that has no bank account of its own", async () => {
    await expect(setBalance(sql, "unassigned" as never, 1, 1)).rejects.toThrow();
    expect(await listBalances(sql)).toEqual([]);
  });
});

describe("parseBalance edge cases", () => {
  it("reads back a negative figure the way the page displays it", () => {
    expect(parseBalance("−₱250.50")).toBe(-250.5);
  });
  it("rejects a figure that only reaches the limit after rounding", () => {
    expect(parseBalance(999999999999.999)).toBeNull();
    expect(parseBalance("999,999,999,999.99")).toBe(999999999999.99);
  });
});
