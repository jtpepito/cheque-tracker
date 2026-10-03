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

  it("ignores cheques dated before today or after the window", () => {
    const days = buildCalendar(
      [cheque({ issueDate: "2026-10-02" }), cheque({ issueDate: "2026-10-17" })],
      TODAY,
    );
    expect(days.every((d) => d.total === 0)).toBe(true);
  });

  it("counts a cheque with no amount but adds zero", () => {
    const days = buildCalendar([cheque({ amount: null }), cheque({ amount: 25 })], TODAY);
    expect(days[0].count).toBe(2);
    expect(days[0].total).toBe(25);
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
        cheque({ issueDate: "2026-10-03", amount: 10 }),
        cheque({ issueDate: "2026-10-05", amount: 20 }),
        cheque({ issueDate: "2026-10-06", amount: 30 }),
      ],
      TODAY,
    );
    expect(dueSoon(days).map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05"]);
  });
  it("is empty when nothing is clearing in the next 2 days", () => {
    expect(dueSoon(buildCalendar([cheque({ issueDate: "2026-10-06" })], TODAY))).toEqual([]);
  });
});
