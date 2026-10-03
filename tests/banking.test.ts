import { beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";
import { clearingDate, isBankingDay, PH_HOLIDAYS_2026, validateHoliday } from "@/lib/banking";
import { addHoliday, listHolidays, removeHoliday } from "@/lib/cheques";

const none = new Set<string>();

describe("isBankingDay", () => {
  it("is false on Saturdays, Sundays and holidays", async () => {
    expect(isBankingDay("2026-10-02", none)).toBe(true); // Friday
    expect(isBankingDay("2026-10-03", none)).toBe(false); // Saturday
    expect(isBankingDay("2026-10-04", none)).toBe(false); // Sunday
    expect(isBankingDay("2026-10-05", none)).toBe(true);
    expect(isBankingDay("2026-10-05", new Set(["2026-10-05"]))).toBe(false);
  });
});

describe("clearingDate", () => {
  it("keeps a banking day as it is", async () => {
    expect(clearingDate("2026-10-05", none)).toBe("2026-10-05");
  });
  it("moves a weekend date to Monday", async () => {
    expect(clearingDate("2026-10-03", none)).toBe("2026-10-05");
    expect(clearingDate("2026-10-04", none)).toBe("2026-10-05");
  });
  it("skips a run of holidays and a weekend", async () => {
    // Thu 24 Dec and Fri 25 Dec 2026 are holidays; the next banking day is Mon 28 Dec.
    const holidays = new Set(["2026-12-24", "2026-12-25"]);
    expect(clearingDate("2026-12-24", holidays)).toBe("2026-12-28");
  });
  it("leaves a blank date blank", async () => {
    expect(clearingDate("", none)).toBe("");
  });
});

describe("validateHoliday", () => {
  it("accepts a real date and a name, trimmed", async () => {
    expect(validateHoliday({ date: "2026-11-30", name: " Bonifacio Day " })).toEqual({
      ok: true,
      value: { date: "2026-11-30", name: "Bonifacio Day" },
    });
  });
  it("rejects an impossible date, a blank name and a name that is too long", async () => {
    expect(validateHoliday({ date: "2026-02-30", name: "X" }).ok).toBe(false);
    expect(validateHoliday({ date: "2026-11-30", name: " " }).ok).toBe(false);
    expect(validateHoliday({ date: "2026-11-30", name: "x".repeat(61) }).ok).toBe(false);
    expect(validateHoliday({ date: 5, name: null }).ok).toBe(false);
  });
});

describe("holidays store", () => {
  let sql: Sql;
  beforeEach(async () => {
    sql = await testSql();
    await resetDb(sql);
  });

  it("starts with the 2026 national holidays, in date order", async () => {
    const all = (await listHolidays(sql));
    expect(all).toEqual(PH_HOLIDAYS_2026);
    expect(all[0]).toEqual({ date: "2026-01-01", name: "New Year's Day" });
    expect(all.map((h) => h.date)).toContain("2026-12-25");
  });

  it("adds a holiday, and renames it when the date is added again", async () => {
    await addHoliday(sql, { date: "2026-03-20", name: "Sample Day" });
    await addHoliday(sql, { date: "2026-03-20", name: "Sample Day (renamed)" });
    expect((await listHolidays(sql)).filter((h) => h.date === "2026-03-20")).toEqual([
      { date: "2026-03-20", name: "Sample Day (renamed)" },
    ]);
  });

  it("removes a holiday and does not bring it back when the database is opened again", async () => {
    await removeHoliday(sql, "2026-12-08");
    expect((await listHolidays(sql)).map((h) => h.date)).not.toContain("2026-12-08");
  });
});
