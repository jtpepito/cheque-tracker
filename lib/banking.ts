import { addDays, isValidDate } from "./dates";

// Banks do not clear cheques on Saturdays, Sundays or holidays. A cheque dated on such a day
// clears on the next banking day.

export type Holiday = { date: string; name: string };

/**
 * 2026 national holidays (regular and special non-working days). Islamic holidays (Eid'l Fitr,
 * Eid'l Adha) are proclaimed separately each year and local holidays vary, so those are added
 * in the page's Bank holidays section.
 */
export const PH_HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-17", name: "Chinese New Year" },
  { date: "2026-04-02", name: "Maundy Thursday" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-04", name: "Black Saturday" },
  { date: "2026-04-09", name: "Araw ng Kagitingan" },
  { date: "2026-05-01", name: "Labor Day" },
  { date: "2026-06-12", name: "Independence Day" },
  { date: "2026-08-21", name: "Ninoy Aquino Day" },
  { date: "2026-08-31", name: "National Heroes Day" },
  { date: "2026-11-01", name: "All Saints' Day" },
  { date: "2026-11-02", name: "All Souls' Day" },
  { date: "2026-11-30", name: "Bonifacio Day" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-30", name: "Rizal Day" },
  { date: "2026-12-31", name: "Last Day of the Year" },
];

function isWeekend(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export function isBankingDay(date: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(date) && !holidays.has(date);
}

/** The day the cheque can clear: its date, or the next banking day. A blank date stays blank. */
export function clearingDate(issueDate: string, holidays: ReadonlySet<string>): string {
  if (!issueDate) return "";
  let date = issueDate;
  while (!isBankingDay(date, holidays)) date = addDays(date, 1);
  return date;
}

/** Why there is no clearing on this date: the holiday's name, "Weekend", or null on a banking day. */
export function closedReason(date: string, holidays: Holiday[]): string | null {
  return holidays.find((h) => h.date === date)?.name ?? (isWeekend(date) ? "Weekend" : null);
}

export type HolidayValidation = { ok: true; value: Holiday } | { ok: false; error: string };

export function validateHoliday(raw: Record<string, unknown>): HolidayValidation {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!isValidDate(raw.date)) return { ok: false, error: "Enter a valid date." };
  if (!name || name.length > 60) return { ok: false, error: "Enter a name of up to 60 characters." };
  return { ok: true, value: { date: raw.date, name } };
}
