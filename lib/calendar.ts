import { clearingDate, closedReason, type Holiday } from "./banking";
import { addDays } from "./dates";
import { sumAmounts } from "./money";
import { COMPANIES, type Cheque, type Company } from "./types";

export type DayTotal = {
  date: string;
  total: number;
  count: number;
  byCompany: Record<Company, number>;
  /** Today through day +2, stretched to the next banking day when day +2 has no clearing. */
  soon: boolean;
  /** Why nothing clears this day (the holiday's name or "Weekend"); null on a banking day. */
  closed: string | null;
  /** The cheques clearing that day, in company order then cheque-number order. */
  items: DayItem[];
};

export type DayItem = {
  company: Company;
  chequeNo: string;
  payee: string;
  amount: number | null;
  /** Set on a cheque from before today that has not cleared: its own date ("" when it has none). */
  from: string | null;
};

/**
 * Totals of issued cheques per clearing day for `days` days starting today. A cheque dated on a
 * weekend or holiday counts on the next banking day. A cheque from before today that is still
 * issued (or has no date) can be presented any day, so it counts on the first banking day of the
 * window, marked with its own date.
 */
export function buildCalendar(cheques: Cheque[], today: string, holidays: Holiday[] = [], days = 14): DayTotal[] {
  const holidayDates = new Set(holidays.map((h) => h.date));
  const issued = cheques
    .filter((c) => c.status === "issued")
    .map((c) => ({ ...c, clears: clearingDate(c.issueDate, holidayDates) }));
  const soonUntil = clearingDate(addDays(today, 2), holidayDates);
  const firstBankingDay = clearingDate(today, holidayDates);
  const isEarlier = (clears: string) => clears === "" || clears < today;
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const onDay = issued.filter((c) => (isEarlier(c.clears) ? date === firstBankingDay : c.clears === date));
    const byCompany = Object.fromEntries(
      COMPANIES.map((co) => [co, sumAmounts(onDay.filter((c) => c.company === co).map((c) => c.amount))]),
    ) as Record<Company, number>;
    return {
      date,
      total: sumAmounts(onDay.map((c) => c.amount)),
      count: onDay.length,
      byCompany,
      soon: date <= soonUntil,
      closed: closedReason(date, holidays),
      items: COMPANIES.flatMap((co) =>
        onDay
          .filter((c) => c.company === co)
          .sort((a, b) => a.chequeNo.localeCompare(b.chequeNo, "en", { numeric: true }))
          .map((c) => ({
            company: co,
            chequeNo: c.chequeNo,
            payee: c.payee,
            amount: c.amount,
            from: isEarlier(c.clears) ? c.issueDate : null,
          })),
      ),
    };
  });
}

/** The days in the alert window that have money clearing. */
export function dueSoon(days: DayTotal[]): DayTotal[] {
  return days.filter((d) => d.soon && d.total > 0);
}
