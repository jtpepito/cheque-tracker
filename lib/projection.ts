import { clearingDate, type Holiday } from "./banking";
import { addDays } from "./dates";
import type { Cheque, Company } from "./types";

// Will each company's bank account cover its cheques? Starting from the balance someone typed in,
// take off every cheque still marked issued as it clears. It is a worst case: money coming in is
// not known here, and neither are bank charges or transfers.

export type Trading = Exclude<Company, "unassigned">;
export const TRADING: readonly Trading[] = ["wwj", "wythlae", "wwjcorp"];

export type Balance = { company: Trading; amount: number; updatedAt: number };

/** After this long the starting balance is too old to rely on. */
export const STALE_BALANCE_MS = 3 * 24 * 60 * 60 * 1000;

export type DayProjection = {
  date: string;
  /** Issued cheques clearing that day. */
  out: number;
  /** Expected balance at the end of the day; null when no balance has been entered. */
  end: number | null;
};

export type CompanyProjection = {
  company: Trading;
  balance: number | null;
  updatedAt: number | null;
  stale: boolean;
  /** Still issued from before today (or with no date): they can be presented any day, so they come off today's balance. */
  overdue: number;
  days: DayProjection[];
  /** The first day the expected balance is below zero. */
  firstShortfall: { date: string; shortBy: number } | null;
};

export type Projection = {
  companies: CompanyProjection[];
  /** Issued cheques with no company: they will hit one of the accounts, but the tracker cannot say which. */
  unassigned: { overdue: number; upcoming: number };
};

const centavos = (amount: number | null) => Math.round((amount ?? 0) * 100);

export function buildProjection(
  cheques: Cheque[],
  balances: Balance[],
  today: string,
  holidays: Holiday[],
  now: number,
  days = 14,
): Projection {
  const holidayDates = new Set(holidays.map((h) => h.date));
  const lastDay = addDays(today, days - 1);
  const issued = cheques
    .filter((c) => c.status === "issued")
    .map((c) => ({ company: c.company, centavos: centavos(c.amount), clears: clearingDate(c.issueDate, holidayDates) }));
  const isOverdue = (clears: string) => clears === "" || clears < today;

  const companies = TRADING.map((company): CompanyProjection => {
    const mine = issued.filter((c) => c.company === company);
    const balance = balances.find((b) => b.company === company) ?? null;
    const overdue = mine.filter((c) => isOverdue(c.clears)).reduce((sum, c) => sum + c.centavos, 0);

    let running = balance === null ? null : centavos(balance.amount) - overdue;
    let firstShortfall: CompanyProjection["firstShortfall"] = null;
    const dayList = Array.from({ length: days }, (_, i): DayProjection => {
      const date = addDays(today, i);
      const out = mine.filter((c) => c.clears === date).reduce((sum, c) => sum + c.centavos, 0);
      if (running !== null) {
        running -= out;
        if (running < 0 && !firstShortfall) firstShortfall = { date, shortBy: -running / 100 };
      }
      return { date, out: out / 100, end: running === null ? null : running / 100 };
    });

    return {
      company,
      balance: balance?.amount ?? null,
      updatedAt: balance?.updatedAt ?? null,
      stale: balance !== null && now - balance.updatedAt > STALE_BALANCE_MS,
      overdue: overdue / 100,
      days: dayList,
      firstShortfall,
    };
  });

  const loose = issued.filter((c) => c.company === "unassigned");
  return {
    companies,
    unassigned: {
      overdue: loose.filter((c) => isOverdue(c.clears)).reduce((sum, c) => sum + c.centavos, 0) / 100,
      upcoming: loose.filter((c) => !isOverdue(c.clears) && c.clears <= lastDay).reduce((sum, c) => sum + c.centavos, 0) / 100,
    },
  };
}
