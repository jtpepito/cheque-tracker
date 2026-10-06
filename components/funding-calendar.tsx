import { dueSoon, type DayTotal } from "@/lib/calendar";
import { shortDate } from "@/lib/dates";
import { cardLines, fundingMessages } from "@/lib/funding-messages";
import { peso } from "@/lib/money";
import type { Projection } from "@/lib/projection";
import type { CompanyNames } from "@/lib/types";

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
  const messages = fundingMessages(projection, names, today);
  const shortDates = new Set(projection.companies.flatMap((c) => (c.firstShortfall ? [c.firstShortfall.date] : [])));

  return (
    <section aria-labelledby="calendar-heading" className="space-y-3">
      <h2 id="calendar-heading" className="text-lg font-semibold">
        Next 14 days
      </h2>

      {messages.alerts.length > 0 && (
        <div role="alert" className="rounded-lg border-2 border-danger p-3 text-sm">
          <p className="font-semibold text-danger">Not enough in the bank:</p>
          <ul className="mt-1 space-y-1">
            {messages.alerts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {messages.covered && (
        <p role="status" className="rounded-lg bg-mint p-3 text-sm">
          {messages.covered}
        </p>
      )}
      {messages.warnings.map((text) => (
        <p key={text} className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          {text}
        </p>
      ))}

      {due.length > 0 ? (
        <div role="status" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          <p className="font-semibold">Fund the bank account before these clear:</p>
          <ul className="mt-1 space-y-0.5">
            {due.map((d) => (
              <li key={d.date}>
                {d.date === today ? "Today" : shortDate(d.date)}: {peso(d.total)} (
                {cardLines(d, projection, names)
                  .filter((s) => s.amount > 0)
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
              {cardLines(d, projection, names).map((s) => (
                <li key={s.label}>
                  <span className="flex flex-wrap justify-between gap-x-2">
                    <span>{s.label}</span>
                    {s.amount > 0 && <span className="font-mono">{peso(s.amount)}</span>}
                  </span>
                  {d.items
                    .filter((item) => item.company === s.company)
                    .map((item, n) => (
                      <span key={n} className="flex justify-between gap-x-2 pl-2 text-muted" title={item.payee}>
                        <span className="font-mono">{item.chequeNo || "(no number)"}</span>
                        <span className="font-mono">{item.amount === null ? "—" : peso(item.amount)}</span>
                      </span>
                    ))}
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
