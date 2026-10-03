import { addDays } from "./dates";
import { sumAmounts } from "./money";
import { COMPANIES, type Cheque, type Company } from "./types";

export type DayTotal = {
  date: string;
  total: number;
  count: number;
  byCompany: Record<Company, number>;
  /** Today through day +2. */
  soon: boolean;
};

/** Totals of issued cheques per cheque date for `days` days starting today. */
export function buildCalendar(cheques: Cheque[], today: string, days = 14): DayTotal[] {
  const issued = cheques.filter((c) => c.status === "issued");
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const onDay = issued.filter((c) => c.issueDate === date);
    const byCompany = Object.fromEntries(
      COMPANIES.map((co) => [co, sumAmounts(onDay.filter((c) => c.company === co).map((c) => c.amount))]),
    ) as Record<Company, number>;
    return { date, total: sumAmounts(onDay.map((c) => c.amount)), count: onDay.length, byCompany, soon: i <= 2 };
  });
}

/** The days in the next 2 days that have money clearing. */
export function dueSoon(days: DayTotal[]): DayTotal[] {
  return days.filter((d) => d.soon && d.total > 0);
}
