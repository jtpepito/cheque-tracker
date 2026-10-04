import { dueSoon, type DayTotal } from "@/lib/calendar";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import type { Projection } from "@/lib/projection";
import { COMPANIES, companyLabel, type CompanyNames } from "@/lib/types";

/** One line per company with money clearing that day, with the expected balance afterwards when known. */
function split(day: DayTotal, index: number, projection: Projection, names: CompanyNames) {
  return COMPANIES.filter((co) => day.byCompany[co] > 0).map((co) => ({
    label: companyLabel(names, co),
    amount: day.byCompany[co],
    end: projection.companies.find((c) => c.company === co)?.days[index]?.end ?? null,
  }));
}

export function FundingCalendar({
  days,
  projection,
  names,
}: {
  days: DayTotal[];
  projection: Projection;
  names: CompanyNames;
}) {
  const due = dueSoon(days);
  const today = days[0].date;
  const short = projection.companies.filter((c) => c.firstShortfall);
  const anyBalance = projection.companies.some((c) => c.balance !== null);
  // Companies with cheques to pay but no balance to check them against.
  const unchecked = projection.companies.filter(
    (c) => c.balance === null && (c.overdue > 0 || c.days.some((d) => d.out > 0)),
  );
  const loose = projection.unassigned;
  const shortDates = new Set(short.map((c) => c.firstShortfall!.date));

  return (
    <section aria-labelledby="calendar-heading" className="space-y-3">
      <h2 id="calendar-heading" className="text-lg font-semibold">
        Next 14 days
      </h2>

      {short.length > 0 && (
        <div role="alert" className="rounded-lg border-2 border-danger p-3 text-sm">
          <p className="font-semibold text-danger">Not enough in the bank:</p>
          <ul className="mt-1 space-y-0.5">
            {short.map((c) => (
              <li key={c.company}>
                {companyLabel(names, c.company)}{" "}
                {c.firstShortfall!.date === today
                  ? `is short by ${peso(c.firstShortfall!.shortBy)} today`
                  : `will be short by ${peso(c.firstShortfall!.shortBy)} on ${shortDate(c.firstShortfall!.date)}`}
                {c.stale ? " (its balance is more than 3 days old)" : ""}.
              </li>
            ))}
          </ul>
        </div>
      )}
      {!anyBalance && (
        <p className="rounded-lg border border-line bg-card p-3 text-sm text-muted">
          Enter the bank balances below to see whether each account will cover its cheques.
        </p>
      )}
      {anyBalance && short.length === 0 && (
        <p role="status" className="rounded-lg bg-mint p-3 text-sm">
          {unchecked.length === 0
            ? "The balances entered cover every assigned cheque clearing in the next 14 days."
            : "The balances entered cover those companies' cheques for the next 14 days."}
        </p>
      )}
      {anyBalance && unchecked.length > 0 && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          Not checked, because no balance is entered: {unchecked.map((c) => companyLabel(names, c.company)).join(", ")}.
        </p>
      )}
      {loose.upcoming + loose.overdue > 0 && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          Not counted against any account, because they have no company: {peso(loose.upcoming)} clearing in the next 14
          days{loose.overdue > 0 ? ` and ${peso(loose.overdue)} from earlier` : ""}.
        </p>
      )}

      {due.length > 0 ? (
        <div role="status" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          <p className="font-semibold">Fund the bank account before these clear:</p>
          <ul className="mt-1 space-y-0.5">
            {due.map((d) => (
              <li key={d.date}>
                {d.date === today ? "Today" : shortDate(d.date)}: {peso(d.total)} (
                {split(d, days.indexOf(d), projection, names)
                  .map((s) => `${s.label} ${peso(s.amount)}`)
                  .join(", ")}
                )
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p role="status" className="rounded-lg bg-mint p-3 text-sm">
          Nothing clearing in the next 2 days.
        </p>
      )}

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d, i) => (
          <li
            key={d.date}
            className={`rounded-lg border p-3 ${
              shortDates.has(d.date)
                ? "border-2 border-danger bg-card"
                : d.soon && d.total > 0
                  ? "border-warn-ink bg-warn text-warn-ink"
                  : "border-line bg-card"
            }`}
          >
            <p className="text-xs font-medium">{i === 0 ? "Today" : shortDate(d.date)}</p>
            {d.closed ? (
              <p className="mt-1 text-xs text-muted">No clearing · {d.closed}</p>
            ) : (
              <p className={`mt-1 font-mono text-sm font-semibold ${d.total === 0 ? "opacity-50" : ""}`}>
                {peso(d.total)}
              </p>
            )}
            <ul className="mt-1 space-y-1 text-xs">
              {split(d, i, projection, names).map((s) => (
                <li key={s.label}>
                  <span className="flex flex-wrap justify-between gap-x-2">
                    <span>{s.label}</span>
                    <span className="font-mono">{peso(s.amount)}</span>
                  </span>
                  {s.end !== null && (
                    <span className={`block text-right font-mono ${s.end < 0 ? "font-semibold text-danger" : "opacity-70"}`}>
                      {s.end < 0 ? `short ${peso(-s.end)}` : `left ${peso(s.end)}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
