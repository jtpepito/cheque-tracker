import { describe, expect, it } from "vitest";
import { buildProjection, STALE_BALANCE_MS, type Balance } from "@/lib/projection";
import { cheque } from "./helpers";

// Monday 5 Oct 2026, 10:00 AM in Manila.
const TODAY = "2026-10-05";
const NOW = Date.UTC(2026, 9, 5, 2, 0);
const balance = (company: Balance["company"], amount: number, updatedAt = NOW): Balance => ({ company, amount, updatedAt });
const wwj = (p: ReturnType<typeof buildProjection>) => p.companies.find((c) => c.company === "wwj")!;

describe("buildProjection", () => {
  it("gives every trading company 14 days, in a fixed order", () => {
    const p = buildProjection([], [], TODAY, [], NOW);
    expect(p.companies.map((c) => c.company)).toEqual(["wwj", "wythlae", "wwjcorp"]);
    expect(p.companies.every((c) => c.days.length === 14 && c.days[0].date === TODAY)).toBe(true);
  });

  it("runs the balance down as each company's issued cheques clear", () => {
    const p = buildProjection(
      [
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: 300 }),
        cheque({ company: "wwj", issueDate: "2026-10-07", amount: 500 }),
        cheque({ company: "wythlae", issueDate: "2026-10-05", amount: 999 }),
      ],
      [balance("wwj", 1000)],
      TODAY,
      [],
      NOW,
    );
    const c = wwj(p);
    expect(c.balance).toBe(1000);
    expect(c.days.slice(0, 3)).toEqual([
      { date: "2026-10-05", out: 300, end: 700 },
      { date: "2026-10-06", out: 0, end: 700 },
      { date: "2026-10-07", out: 500, end: 200 },
    ]);
    expect(c.days[13].end).toBe(200);
    expect(c.firstShortfall).toBeNull();
  });

  it("flags the first day the balance goes below zero, with the amount short", () => {
    const p = buildProjection(
      [
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: 300 }),
        cheque({ company: "wwj", issueDate: "2026-10-07", amount: 500 }),
        cheque({ company: "wwj", issueDate: "2026-10-09", amount: 100 }),
      ],
      [balance("wwj", 600)],
      TODAY,
      [],
      NOW,
    );
    expect(wwj(p).days[2].end).toBe(-200);
    expect(wwj(p).days[4].end).toBe(-300);
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-07", shortBy: 200 });
  });

  it("treats a balance that lands on exactly zero as covered, and one centavo under as short", () => {
    const cheques = [cheque({ company: "wwj", issueDate: "2026-10-05", amount: 0.1 }), cheque({ company: "wwj", issueDate: "2026-10-05", amount: 0.2 })];
    expect(wwj(buildProjection(cheques, [balance("wwj", 0.3)], TODAY, [], NOW)).firstShortfall).toBeNull();
    expect(wwj(buildProjection(cheques, [balance("wwj", 0.3)], TODAY, [], NOW)).days[0].end).toBe(0);
    expect(wwj(buildProjection(cheques, [balance("wwj", 0.29)], TODAY, [], NOW)).firstShortfall).toEqual({
      date: "2026-10-05",
      shortBy: 0.01,
    });
  });

  it("counts a weekend or holiday cheque on the next banking day", () => {
    const p = buildProjection(
      [cheque({ company: "wwj", issueDate: "2026-10-10", amount: 50 }), cheque({ company: "wwj", issueDate: "2026-10-08", amount: 20 })],
      [balance("wwj", 100)],
      TODAY,
      [{ date: "2026-10-08", name: "Sample Holiday" }],
      NOW,
    );
    const day = (date: string) => wwj(p).days.find((d) => d.date === date)!;
    expect(day("2026-10-08").out).toBe(0);
    expect(day("2026-10-09")).toEqual({ date: "2026-10-09", out: 20, end: 80 });
    expect(day("2026-10-10").out).toBe(0);
    expect(day("2026-10-12")).toEqual({ date: "2026-10-12", out: 50, end: 30 });
  });

  it("takes cheques still issued from before today off today's balance, including ones with no date", () => {
    const p = buildProjection(
      [
        cheque({ company: "wwj", issueDate: "2026-10-01", amount: 400 }),
        cheque({ company: "wwj", issueDate: "", amount: 50 }),
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: 100 }),
      ],
      [balance("wwj", 500)],
      TODAY,
      [],
      NOW,
    );
    expect(wwj(p).overdue).toBe(450);
    expect(wwj(p).days[0]).toEqual({ date: "2026-10-05", out: 100, end: -50 });
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-05", shortBy: 50 });
  });

  it("does not count a Sunday cheque as overdue on Monday: it clears today", () => {
    const p = buildProjection([cheque({ company: "wwj", issueDate: "2026-10-04", amount: 70 })], [balance("wwj", 100)], TODAY, [], NOW);
    expect(wwj(p).overdue).toBe(0);
    expect(wwj(p).days[0]).toEqual({ date: "2026-10-05", out: 70, end: 30 });
  });

  it("ignores pending, cleared and voided cheques, and cheques beyond the 14 days", () => {
    const p = buildProjection(
      [
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: 10, status: "pending" }),
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: 10, status: "cleared" }),
        cheque({ company: "wwj", issueDate: "2026-10-01", amount: 10, status: "voided" }),
        cheque({ company: "wwj", issueDate: "2026-10-19", amount: 10 }),
        cheque({ company: "wwj", issueDate: "2026-10-05", amount: null }),
      ],
      [balance("wwj", 100)],
      TODAY,
      [],
      NOW,
    );
    expect(wwj(p).overdue).toBe(0);
    expect(wwj(p).days.every((d) => d.out === 0 && d.end === 100)).toBe(true);
  });

  it("leaves unassigned cheques out of every company and totals them separately", () => {
    const p = buildProjection(
      [
        cheque({ company: "unassigned", issueDate: "2026-10-06", amount: 200 }),
        cheque({ company: "unassigned", issueDate: "2026-10-01", amount: 30 }),
        cheque({ company: "unassigned", issueDate: "2026-10-20", amount: 999 }),
      ],
      [balance("wwj", 100), balance("wythlae", 100), balance("wwjcorp", 100)],
      TODAY,
      [],
      NOW,
    );
    expect(p.companies.every((c) => c.overdue === 0 && c.days.every((d) => d.out === 0))).toBe(true);
    expect(p.unassigned).toEqual({ overdue: 30, upcoming: 200 });
  });

  it("shows what is clearing but no balance when a company has none entered", () => {
    const p = buildProjection([cheque({ company: "wwj", issueDate: "2026-10-05", amount: 300 })], [], TODAY, [], NOW);
    expect(wwj(p)).toMatchObject({ balance: null, updatedAt: null, stale: false, firstShortfall: null });
    expect(wwj(p).days[0]).toEqual({ date: "2026-10-05", out: 300, end: null });
  });

  it("accepts an overdrawn starting balance", () => {
    const p = buildProjection([], [balance("wwj", -250.5)], TODAY, [], NOW);
    expect(wwj(p).days[0].end).toBe(-250.5);
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-05", shortBy: 250.5 });
  });

  it("marks a balance entered more than three days ago as stale", () => {
    const fresh = buildProjection([], [balance("wwj", 1, NOW - STALE_BALANCE_MS)], TODAY, [], NOW);
    const old = buildProjection([], [balance("wwj", 1, NOW - STALE_BALANCE_MS - 1)], TODAY, [], NOW);
    expect(wwj(fresh).stale).toBe(false);
    expect(wwj(old).stale).toBe(true);
    expect(wwj(old).updatedAt).toBe(NOW - STALE_BALANCE_MS - 1);
  });
});

describe("buildProjection: cleared since the balance was entered", () => {
  it("also takes off cheques marked cleared after the balance was entered, since the balance may still include them", () => {
    const p = buildProjection(
      [
        cheque({ company: "wwj", issueDate: "2026-10-02", amount: 600, status: "cleared", statusChangedAt: NOW + 1000 }),
        cheque({ company: "wwj", issueDate: "2026-10-01", amount: 111, status: "cleared", statusChangedAt: NOW - 1000 }),
        cheque({ company: "wwj", issueDate: "2026-10-01", amount: 222, status: "cleared", statusChangedAt: null }),
        cheque({ company: "wwj", issueDate: "2026-10-01", amount: 333, status: "voided", statusChangedAt: NOW + 1000 }),
        cheque({ company: "wwj", issueDate: "2026-10-08", amount: 500 }),
      ],
      [balance("wwj", 1000)],
      TODAY,
      [],
      NOW,
    );
    expect(wwj(p).clearedSince).toBe(600);
    expect(wwj(p).days[0].end).toBe(400);
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-08", shortBy: 100 });
  });

  it("reports nothing cleared since when there is no balance", () => {
    const p = buildProjection([cheque({ company: "wwj", status: "cleared", statusChangedAt: NOW })], [], TODAY, [], NOW);
    expect(wwj(p).clearedSince).toBe(0);
  });
});

describe("buildProjection: the deepest shortfall", () => {
  it("gives the lowest point in the 14 days, which can be later and deeper than the first", () => {
    const p = buildProjection(
      [cheque({ company: "wwj", issueDate: "2026-10-07", amount: 700 }), cheque({ company: "wwj", issueDate: "2026-10-09", amount: 100 })],
      [balance("wwj", 500)],
      TODAY,
      [],
      NOW,
    );
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-07", shortBy: 200 });
    expect(wwj(p).lowest).toEqual({ date: "2026-10-09", shortBy: 300 });
  });

  it("has no lowest point when the balance never goes below zero", () => {
    expect(wwj(buildProjection([], [balance("wwj", 5)], TODAY, [], NOW)).lowest).toBeNull();
  });

  it("is short today on a weekend when earlier cheques already exceed the balance", () => {
    const p = buildProjection([cheque({ company: "wwj", issueDate: "2026-09-30", amount: 450 })], [balance("wwj", 400)], "2026-10-03", [], NOW);
    expect(wwj(p).firstShortfall).toEqual({ date: "2026-10-03", shortBy: 50 });
  });

  it("leaves out a cheque dated inside the 14 days that rolls to a banking day beyond them", () => {
    // Sunday 18 Oct is day 14; it clears Monday 19 Oct, outside the window.
    const p = buildProjection([cheque({ company: "wwj", issueDate: "2026-10-18", amount: 999 })], [balance("wwj", 100)], TODAY, [], NOW);
    expect(wwj(p).days.every((d) => d.out === 0)).toBe(true);
    expect(wwj(p).firstShortfall).toBeNull();
  });
});
