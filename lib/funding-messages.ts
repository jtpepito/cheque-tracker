import type { DayTotal } from "./calendar";
import { shortDate } from "./dates";
import { peso } from "./money";
import type { CompanyProjection, Projection } from "./projection";
import { manilaTime } from "./sync-status";
import { COMPANIES, companyLabel, type Company, type CompanyNames } from "./types";

// The wording of the calendar's messages, kept apart from the page so it can be tested.
// The rule throughout: never say "covered" unless the tracker has really checked.

export type FundingMessages = {
  /** One sentence per company that will be short. */
  alerts: string[];
  /** The all-clear, or null when it cannot honestly be given. */
  covered: string | null;
  /** What was not checked, or should be looked at. */
  warnings: string[];
};

function alertFor(c: CompanyProjection, label: string, today: string): string {
  const first = c.firstShortfall!;
  let text =
    first.date === today
      ? `${label} is short by ${peso(first.shortBy)} today`
      : `${label} will be short by ${peso(first.shortBy)} on ${shortDate(first.date)}`;
  if (c.lowest && c.lowest.shortBy > first.shortBy) {
    text += `, and by ${peso(c.lowest.shortBy)} by ${shortDate(c.lowest.date)}`;
  }
  text += ".";
  const counted: string[] = [];
  if (c.overdue > 0) counted.push(`${peso(c.overdue)} of earlier cheques not yet cleared`);
  if (c.clearedSince > 0) counted.push(`${peso(c.clearedSince)} marked cleared since the balance was entered`);
  if (counted.length) text += ` This counts ${counted.join(" and ")}.`;
  if (c.stale) text += " Its balance is more than 3 days old.";
  return text;
}

export function fundingMessages(projection: Projection, names: CompanyNames, today: string): FundingMessages {
  const label = (c: CompanyProjection) => companyLabel(names, c.company);
  const checked = projection.companies.filter((c) => c.balance !== null);
  const short = checked.filter((c) => c.firstShortfall);
  // Companies with cheques to pay but no balance to check them against.
  const unchecked = projection.companies.filter(
    (c) => c.balance === null && (c.overdue > 0 || c.days.some((d) => d.out > 0)),
  );
  const staleNotShort = checked.filter((c) => c.stale && !c.firstShortfall);
  const warnings: string[] = [];

  if (checked.length === 0) {
    warnings.push("Enter the bank balances below to see whether each account will cover its cheques.");
  }
  for (const c of staleNotShort) {
    warnings.push(
      `${label(c)}'s balance was entered ${manilaTime(c.updatedAt!)}, more than 3 days ago. Check the bank and enter it again.`,
    );
  }
  if (checked.length > 0 && unchecked.length > 0) {
    warnings.push(`Not checked, because no balance is entered: ${unchecked.map(label).join(", ")}.`);
  }
  const { upcoming, overdue } = projection.unassigned;
  if (upcoming > 0 || overdue > 0) {
    const parts: string[] = [];
    if (upcoming > 0) parts.push(`${peso(upcoming)} clearing in the next 14 days`);
    if (overdue > 0) parts.push(`${peso(overdue)} from earlier`);
    warnings.push(`Not counted against any account, because they have no company: ${parts.join(" and ")}.`);
  }

  let covered: string | null = null;
  if (checked.length > 0 && short.length === 0 && staleNotShort.length === 0) {
    const asOf = checked.map((c) => `${label(c)} as of ${manilaTime(c.updatedAt!)}`).join("; ");
    covered =
      (unchecked.length === 0
        ? "The balances entered cover every assigned cheque clearing in the next 14 days"
        : "The balances entered cover those companies' cheques for the next 14 days") + ` (${asOf}).`;
  }

  return { alerts: short.map((c) => alertFor(c, label(c), today)), covered, warnings };
}

export type CardLine = { company: Company; label: string; amount: number; end: number | null };

/**
 * The lines on one day's card: each company with money clearing that day and what is left after,
 * plus any company that first goes short that day even if none of its cheques clears then (it can
 * be short from earlier cheques, or on a weekend).
 */
export function cardLines(day: DayTotal, projection: Projection, names: CompanyNames): CardLine[] {
  return COMPANIES.flatMap((co) => {
    const company = projection.companies.find((c) => c.company === co);
    const amount = day.byCompany[co];
    const firstShortHere = company?.firstShortfall?.date === day.date;
    if (amount <= 0 && !firstShortHere) return [];
    const end = company?.days.find((d) => d.date === day.date)?.end ?? null;
    return [{ company: co, label: companyLabel(names, co), amount, end }];
  });
}
