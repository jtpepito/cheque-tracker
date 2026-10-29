import { describe, expect, it } from "vitest";
import { buildCalendar, dueSoon } from "@/lib/calendar";
import { cheque } from "./helpers";

const TODAY = "2026-10-03";

describe("buildCalendar", () => {
  it("returns 14 consecutive days starting today", () => {
    const days = buildCalendar([], TODAY);
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-10-03");
    expect(days[13].date).toBe("2026-10-16");
    expect(days.every((d) => d.total === 0 && d.count === 0)).toBe(true);
  });

  it("counts only issued cheques, on their cheque date, split by company", () => {
    const days = buildCalendar(
      [
        cheque({ issueDate: "2026-10-05", company: "wwj", amount: 1000.1 }),
        cheque({ issueDate: "2026-10-05", company: "wwj", amount: 2000.2 }),
        cheque({ issueDate: "2026-10-05", company: "unassigned", amount: 50 }),
        cheque({ issueDate: "2026-10-05", status: "pending", amount: 999 }),
        cheque({ issueDate: "2026-10-05", status: "cleared", amount: 999 }),
        cheque({ issueDate: "2026-10-05", status: "voided", amount: 999 }),
      ],
      TODAY,
    );
    const day = days[2];
    expect(day.total).toBe(3050.3);
    expect(day.count).toBe(3);
    expect(day.byCompany).toEqual({ wwj: 3000.3, wythlae: 0, wwjcorp: 0, unassigned: 50 });
  });

  it("ignores cheques after the window", () => {
    const days = buildCalendar([cheque({ issueDate: "2026-10-17" })], TODAY);
    expect(days.every((d) => d.total === 0)).toBe(true);
  });

  it("puts issued cheques from before today on today, marked with their own date, since they can still be presented", () => {
    const days = buildCalendar(
      [
        cheque({ issueDate: "2026-10-06", company: "wwjcorp", chequeNo: "CORP 652506", amount: 70 }),
        cheque({ issueDate: "2026-10-07", company: "wwjcorp", chequeNo: "CORP 652507", amount: 30 }),
        cheque({ issueDate: "", company: "wwj", chequeNo: "500", amount: 5 }),
        cheque({ issueDate: "2026-10-06", company: "wwj", status: "cleared", amount: 999 }),
      ],
      "2026-10-07",
    );
    expect(days[0]).toMatchObject({ date: "2026-10-07", total: 105, count: 3 });
    expect(days[0].byCompany).toEqual({ wwj: 5, wythlae: 0, wwjcorp: 100, unassigned: 0 });
    expect(days[0].items).toEqual([
      { company: "wwj", chequeNo: "500", payee: "Sample Supplier", amount: 5, from: "" },
      { company: "wwjcorp", chequeNo: "CORP 652506", payee: "Sample Supplier", amount: 70, from: "2026-10-06" },
      { company: "wwjcorp", chequeNo: "CORP 652507", payee: "Sample Supplier", amount: 30, from: null },
    ]);
    expect(days.slice(1).every((d) => d.total === 0)).toBe(true);
  });

  it("puts earlier cheques on the first banking day when today has no clearing", () => {
    // 3 Oct 2026 is a Saturday: a cheque from Friday 2 Oct shows on Monday 5 Oct.
    const days = buildCalendar([cheque({ issueDate: "2026-10-02", amount: 12 })], TODAY);
    expect(days[0].total).toBe(0);
    expect(days[2]).toMatchObject({ date: "2026-10-05", total: 12, count: 1 });
    expect(days[2].items[0].from).toBe("2026-10-02");
    expect(dueSoon(days).map((d) => d.date)).toEqual(["2026-10-05"]);
  });

  it("counts a cheque with no amount but adds zero", () => {
    const monday = { issueDate: "2026-10-05" };
    const days = buildCalendar([cheque({ ...monday, amount: null }), cheque({ ...monday, amount: 25 })], TODAY);
    expect(days[2].count).toBe(2);
    expect(days[2].total).toBe(25);
  });

  it("moves a weekend cheque to the next banking day", () => {
    // 3 Oct 2026 is a Saturday, 4 Oct a Sunday.
    const days = buildCalendar(
      [cheque({ issueDate: "2026-10-03", amount: 10 }), cheque({ issueDate: "2026-10-04", amount: 20 })],
      TODAY,
    );
    expect(days[0].total).toBe(0);
    expect(days[1].total).toBe(0);
    expect(days[2]).toMatchObject({ date: "2026-10-05", total: 30, count: 2 });
  });

  it("moves a holiday cheque to the next banking day, past a weekend if needed", () => {
    const holidays = [{ date: "2026-10-09", name: "Sample Holiday" }];
    const days = buildCalendar([cheque({ issueDate: "2026-10-09", amount: 40 })], TODAY, holidays);
    expect(days.find((d) => d.date === "2026-10-09")!.total).toBe(0);
    expect(days.find((d) => d.date === "2026-10-12")!.total).toBe(40);
  });

  it("counts a cheque dated before today when its clearing day is today or later", () => {
    const days = buildCalendar([cheque({ issueDate: "2026-10-04", amount: 15 })], "2026-10-05");
    expect(days[0]).toMatchObject({ date: "2026-10-05", total: 15 });
  });

  it("says why a day has no clearing", () => {
    const days = buildCalendar([], TODAY, [{ date: "2026-10-09", name: "Sample Holiday" }]);
    expect(days.slice(0, 3).map((d) => d.closed)).toEqual(["Weekend", "Weekend", null]);
    expect(days.find((d) => d.date === "2026-10-09")!.closed).toBe("Sample Holiday");
  });

  it("stretches the soon window to the next banking day when day +2 has no clearing", () => {
    // Friday: day +2 is Sunday, so Monday is included.
    const days = buildCalendar([], "2026-10-02");
    expect(days.map((d) => d.soon)).toEqual([true, true, true, true, ...Array(10).fill(false)]);
  });

  it("marks today through day +2 as soon", () => {
    const days = buildCalendar([], TODAY);
    expect(days.map((d) => d.soon)).toEqual([true, true, true, ...Array(11).fill(false)]);
  });
});

describe("dueSoon", () => {
  it("lists only soon days with money clearing", () => {
    const days = buildCalendar(
      [
        cheque({ issueDate: "2026-10-05", amount: 10 }),
        cheque({ issueDate: "2026-10-06", amount: 20 }),
        cheque({ issueDate: "2026-10-07", amount: 30 }),
      ],
      "2026-10-05",
    );
    expect(dueSoon(days).map((d) => d.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"].slice(0, 3));
    expect(dueSoon(buildCalendar([cheque({ issueDate: "2026-10-08", amount: 5 })], "2026-10-05"))).toEqual([]);
  });
  it("is empty when nothing is clearing in the next 2 days", () => {
    expect(dueSoon(buildCalendar([cheque({ issueDate: "2026-10-06" })], TODAY))).toEqual([]);
  });
});

describe("buildCalendar: the cheques on each day", () => {
  it("lists each day's issued cheques by company, in cheque-number order", () => {
    const days = buildCalendar(
      [
        cheque({ company: "wwj", issueDate: "2026-10-05", chequeNo: "653520", payee: "Sample B", amount: 200 }),
        cheque({ company: "wwj", issueDate: "2026-10-05", chequeNo: "653507", payee: "Sample A", amount: 100 }),
        cheque({ company: "unassigned", issueDate: "2026-10-03", chequeNo: "WWJ1", payee: "Sample C", amount: null }),
        cheque({ company: "wwj", issueDate: "2026-10-05", chequeNo: "999", payee: "Not this one", amount: 5, status: "cleared" }),
      ],
      TODAY,
    );
    expect(days[2].items).toEqual([
      { company: "wwj", chequeNo: "653507", payee: "Sample A", amount: 100, from: null },
      { company: "wwj", chequeNo: "653520", payee: "Sample B", amount: 200, from: null },
      { company: "unassigned", chequeNo: "WWJ1", payee: "Sample C", amount: null, from: null },
    ]);
    expect(days[0].items).toEqual([]);
  });
});
