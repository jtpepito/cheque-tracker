import { dueSoon, type DayItem, type DayTotal } from "@/lib/calendar";
import { addDays, shortDate } from "@/lib/dates";
import { cardLines, fundingMessages } from "@/lib/funding-messages";
import { peso, sumAmounts } from "@/lib/money";
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
        <div role="alert" className="rounded-lg border-2 border-accent p-4 text-sm leading-relaxed">
          <p className="font-bold uppercase tracking-wide text-danger">Not enough in the bank</p>
          <ul className="mt-2 space-y-3">
            {messages.alerts.map((text) => {
              // The first sentence says how short; the rest explains what was counted.
              const [first, ...rest] = text.split(/(?<=\.)\s+/);
              return (
                <li key={text}>
                  <p className="font-medium">{first}</p>
                  {rest.length > 0 && <p className="text-muted">{rest.join(" ")}</p>}
                </li>
              );
            })}
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

      <ol className="grid grid-cols-2 items-start gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d, i) => (
          <li
            key={d.date}
            className={`min-w-0 rounded-lg border p-3 ${
              shortDates.has(d.date)
                ? "border-2 border-accent bg-card"
                : d.soon && d.total > 0
                  ? "border-warn-ink bg-warn text-warn-ink"
                  : "border-line bg-card"
            }`}
          >
            <p className="text-xs font-medium">{i === 0 ? "Today" : shortDate(d.date)}</p>
            {d.closed ? (
              <p className="mt-1 text-xs text-muted">No clearing · {d.closed}</p>
            ) : (
              <p className={`mt-1 font-mono text-sm font-semibold [overflow-wrap:anywhere] ${d.total === 0 ? "opacity-50" : ""}`}>
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
                    .filter((item) => item.company === s.company && item.from === null)
                    .map((item, n) => (
                      <ChequeLine key={n} item={item} />
                    ))}
                  <EarlierCheques date={d.date} items={d.items.filter((item) => item.company === s.company && item.from !== null)} />
                  {s.end !== null && (
                    <span className={`block text-right font-mono [overflow-wrap:anywhere] ${s.end < 0 ? "font-semibold text-danger" : "opacity-70"}`}>
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

function ChequeLine({ item }: { item: DayItem }) {
  return (
    <span className="block pl-2 text-muted" title={item.payee}>
      <span className="flex flex-wrap justify-between gap-x-2">
        <span className="min-w-0 font-mono [overflow-wrap:anywhere]">{item.chequeNo || "(no number)"}</span>
        <span className="ml-auto font-mono">{item.amount === null ? "—" : peso(item.amount)}</span>
      </span>
      {item.from !== null && (
        <span className="block text-danger">{item.from ? `dated ${shortDate(item.from)}` : "no date"}</span>
      )}
    </span>
  );
}

/** Earlier cheques dated within this many days of the box are always listed. */
const RECENT_DAYS = 7;

/**
 * Cheques from before today that have not cleared. Those from the past week are always listed,
 * so yesterday's cheques are never hidden; older ones fold away so the box stays a sensible height.
 */
function EarlierCheques({ items, date }: { items: DayItem[]; date: string }) {
  if (items.length === 0) return null;
  const cutoff = addDays(date, -RECENT_DAYS);
  // Newest first; cheques with no date last.
  const sorted = [...items].sort((a, b) => (b.from || "").localeCompare(a.from || ""));
  const shown = sorted.filter((i) => !!i.from && i.from >= cutoff);
  const rest = sorted.filter((i) => !i.from || i.from < cutoff);
  const total = sumAmounts(items.map((i) => i.amount));
  return (
    <span className="mt-1 block">
      <span className="flex flex-wrap justify-between gap-x-2 pl-2 font-medium text-danger">
        <span>
          Earlier, not cleared{items.length > 1 ? ` (${items.length})` : ""}
        </span>
        <span className="ml-auto font-mono">{peso(total)}</span>
      </span>
      {shown.map((item, n) => (
        <ChequeLine key={n} item={item} />
      ))}
      {rest.length > 0 && (
        <details className="pl-2">
          <summary className="cursor-pointer text-accent">{rest.length} older</summary>
          {rest.map((item, n) => (
            <ChequeLine key={n} item={item} />
          ))}
        </details>
      )}
    </span>
  );
}
