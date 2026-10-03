import { dueSoon, type DayTotal } from "@/lib/calendar";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { COMPANIES, companyLabel, type CompanyNames } from "@/lib/types";

function split(day: DayTotal, names: CompanyNames) {
  return COMPANIES.filter((co) => day.byCompany[co] > 0).map((co) => ({
    label: companyLabel(names, co),
    amount: day.byCompany[co],
  }));
}

export function FundingCalendar({ days, names }: { days: DayTotal[]; names: CompanyNames }) {
  const due = dueSoon(days);
  return (
    <section aria-labelledby="calendar-heading" className="space-y-3">
      <h2 id="calendar-heading" className="text-lg font-semibold">
        Next 14 days
      </h2>
      {due.length > 0 ? (
        <div role="status" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          <p className="font-semibold">Fund the bank account before these clear:</p>
          <ul className="mt-1 space-y-0.5">
            {due.map((d, i) => (
              <li key={d.date}>
                {i === 0 && d.date === days[0].date ? "Today" : shortDate(d.date)}: {peso(d.total)} (
                {split(d, names)
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
              d.soon && d.total > 0 ? "border-warn-ink bg-warn text-warn-ink" : "border-line bg-card"
            }`}
          >
            <p className="text-xs font-medium">{i === 0 ? "Today" : shortDate(d.date)}</p>
            <p className={`mt-1 font-mono text-sm font-semibold ${d.total === 0 ? "opacity-50" : ""}`}>
              {peso(d.total)}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {split(d, names).map((s) => (
                <li key={s.label} className="flex flex-wrap justify-between gap-x-2">
                  <span>{s.label}</span>
                  <span className="font-mono">{peso(s.amount)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
