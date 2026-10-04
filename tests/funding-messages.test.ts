import { describe, expect, it } from "vitest";
import { buildCalendar } from "@/lib/calendar";
import { cardLines, fundingMessages } from "@/lib/funding-messages";
import { buildProjection, STALE_BALANCE_MS, type Balance } from "@/lib/projection";
import { DEFAULT_COMPANY_NAMES as NAMES } from "@/lib/types";
import { cheque } from "./helpers";

// Monday 5 Oct 2026, 10:00 AM in Manila.
const TODAY = "2026-10-05";
const NOW = Date.UTC(2026, 9, 5, 2, 0);
const balance = (company: Balance["company"], amount: number, updatedAt = NOW): Balance => ({ company, amount, updatedAt });
const messages = (cheques: Parameters<typeof buildProjection>[0], balances: Balance[], today = TODAY) =>
  fundingMessages(buildProjection(cheques, balances, today, [], NOW), NAMES, today);

describe("fundingMessages", () => {
  it("asks for balances when none is entered, and never says covered", () => {
    const m = messages([cheque({ company: "wwj", issueDate: "2026-10-06", amount: 100 })], []);
    expect(m.covered).toBeNull();
    expect(m.alerts).toEqual([]);
    expect(m.warnings).toEqual(["Enter the bank balances below to see whether each account will cover its cheques."]);
  });

  it("says covered, with when each balance was entered, only when every company with cheques is checked", () => {
    const m = messages([cheque({ company: "wwj", issueDate: "2026-10-06", amount: 100 })], [balance("wwj", 500)]);
    expect(m.covered).toBe(
      "The balances entered cover every assigned cheque clearing in the next 14 days (WWJ Trading as of 5 Oct, 10:00 AM).",
    );
    expect(m.alerts).toEqual([]);
    expect(m.warnings).toEqual([]);
  });

  it("names the companies it could not check for lack of a balance", () => {
    const m = messages(
      [cheque({ company: "wwj", issueDate: "2026-10-06", amount: 100 }), cheque({ company: "wwjcorp", issueDate: "2026-10-07", amount: 50 })],
      [balance("wwj", 500)],
    );
    expect(m.covered).toBe("The balances entered cover those companies' cheques for the next 14 days (WWJ Trading as of 5 Oct, 10:00 AM).");
    expect(m.warnings).toEqual(["Not checked, because no balance is entered: WWJ Corp."]);
  });

  it("does not say covered on a balance more than three days old", () => {
    const old = NOW - STALE_BALANCE_MS - 60_000;
    const m = messages([cheque({ company: "wwj", issueDate: "2026-10-06", amount: 100 })], [balance("wwj", 500, old)]);
    expect(m.covered).toBeNull();
    expect(m.warnings).toEqual([
      "WWJ Trading's balance was entered 2 Oct, 9:59 AM, more than 3 days ago. Check the bank and enter it again.",
    ]);
  });

  it("names the first day short and the amount", () => {
    const m = messages(
      [cheque({ company: "wwj", issueDate: "2026-10-07", amount: 700 })],
      [balance("wwj", 500), balance("wythlae", 10)],
    );
    expect(m.alerts).toEqual(["WWJ Trading will be short by ₱200.00 on Wed, 7 Oct."]);
    expect(m.covered).toBeNull();
  });

  it("also gives the deepest shortfall in the 14 days when it is worse than the first", () => {
    const m = messages(
      [cheque({ company: "wwj", issueDate: "2026-10-07", amount: 700 }), cheque({ company: "wwj", issueDate: "2026-10-09", amount: 100 })],
      [balance("wwj", 500)],
    );
    expect(m.alerts).toEqual(["WWJ Trading will be short by ₱200.00 on Wed, 7 Oct, and by ₱300.00 by Fri, 9 Oct."]);
  });

  it("explains a shortfall today that comes from earlier cheques not yet cleared", () => {
    const m = messages(
      [cheque({ company: "wwj", issueDate: "2026-10-01", amount: 450 }), cheque({ company: "wwj", issueDate: "2026-10-05", amount: 100 })],
      [balance("wwj", 500)],
    );
    expect(m.alerts).toEqual([
      "WWJ Trading is short by ₱50.00 today. This counts ₱450.00 of earlier cheques not yet cleared.",
    ]);
  });

  it("explains cheques marked cleared since the balance was entered", () => {
    const m = messages(
      [
        cheque({ company: "wwj", issueDate: "2026-10-02", amount: 600, status: "cleared", statusChangedAt: NOW + 1000 }),
        cheque({ company: "wwj", issueDate: "2026-10-08", amount: 500 }),
      ],
      [balance("wwj", 1000)],
    );
    expect(m.alerts).toEqual([
      "WWJ Trading will be short by ₱100.00 on Thu, 8 Oct. This counts ₱600.00 marked cleared since the balance was entered.",
    ]);
  });

  it("flags a stale balance inside the alert too", () => {
    const old = NOW - STALE_BALANCE_MS - 60_000;
    const m = messages([cheque({ company: "wwj", issueDate: "2026-10-07", amount: 700 })], [balance("wwj", 500, old)]);
    expect(m.alerts).toEqual(["WWJ Trading will be short by ₱200.00 on Wed, 7 Oct. Its balance is more than 3 days old."]);
    expect(m.warnings).toEqual([]);
  });

  it("warns about cheques with no company, wording it by what there is", () => {
    const both = messages(
      [cheque({ company: "unassigned", issueDate: "2026-10-06", amount: 200 }), cheque({ company: "unassigned", issueDate: "2026-10-01", amount: 30 })],
      [balance("wwj", 1)],
    );
    expect(both.warnings).toContain(
      "Not counted against any account, because they have no company: ₱200.00 clearing in the next 14 days and ₱30.00 from earlier.",
    );
    const upcoming = messages([cheque({ company: "unassigned", issueDate: "2026-10-06", amount: 200 })], [balance("wwj", 1)]);
    expect(upcoming.warnings).toContain(
      "Not counted against any account, because they have no company: ₱200.00 clearing in the next 14 days.",
    );
    const earlier = messages([cheque({ company: "unassigned", issueDate: "2026-10-01", amount: 30 })], [balance("wwj", 1)]);
    expect(earlier.warnings).toContain("Not counted against any account, because they have no company: ₱30.00 from earlier.");
  });
});

describe("cardLines", () => {
  const lines = (cheques: Parameters<typeof buildProjection>[0], balances: Balance[], today: string, date: string) => {
    const days = buildCalendar(cheques, today);
    const projection = buildProjection(cheques, balances, today, [], NOW);
    return cardLines(days.find((d) => d.date === date)!, projection, NAMES);
  };

  it("lists each company clearing that day with what is left afterwards", () => {
    expect(
      lines(
        [cheque({ company: "wwj", issueDate: "2026-10-06", amount: 300 }), cheque({ company: "unassigned", issueDate: "2026-10-06", amount: 40 })],
        [balance("wwj", 1000)],
        TODAY,
        "2026-10-06",
      ),
    ).toEqual([
      { label: "WWJ Trading", amount: 300, end: 700 },
      { label: "Unassigned", amount: 40, end: null },
    ]);
  });

  it("shows the company that first goes short that day even when none of its cheques clears then", () => {
    // Saturday: nothing clears, but the account is already short from an earlier cheque.
    expect(
      lines([cheque({ company: "wwj", issueDate: "2026-09-30", amount: 450 })], [balance("wwj", 400)], "2026-10-03", "2026-10-03"),
    ).toEqual([{ label: "WWJ Trading", amount: 0, end: -50 }]);
  });

  it("shows nothing for a company with no cheque that day and no first shortfall", () => {
    expect(lines([cheque({ company: "wwj", issueDate: "2026-10-06", amount: 300 })], [balance("wwj", 1000)], TODAY, "2026-10-07")).toEqual([]);
  });
});
