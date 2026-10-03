"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Holiday } from "@/lib/banking";
import { shortDate } from "@/lib/dates";

/** Days with no bank clearing besides weekends. Cheques dated on them move to the next banking day. */
export function Holidays({
  holidays,
  today,
  onChanged,
}: {
  holidays: Holiday[];
  today: string;
  onChanged: () => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const upcoming = holidays.filter((h) => h.date >= today);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      await api<Holiday>("/api/holidays", "POST", { date, name });
      setDate("");
      setName("");
    });
  }

  return (
    <details className="rounded-xl border border-line bg-card p-4">
      <summary className="cursor-pointer text-lg font-semibold">Bank holidays ({upcoming.length} coming up)</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-muted">
          A cheque dated on a Saturday, a Sunday or one of these days is counted on the next banking day.
        </p>
        {upcoming.length === 0 ? (
          <p className="text-muted">No holidays listed from today on. Add the next ones below.</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {upcoming.map((h) => (
              <li key={h.date} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5">
                <span>
                  <span className="font-medium">
                    {shortDate(h.date)} {h.date.slice(0, 4)}
                  </span>{" "}
                  {h.name}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  aria-label={`Remove ${h.name}, ${h.date}`}
                  onClick={() => run(() => api(`/api/holidays/${h.date}`, "DELETE"))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-muted">Date</span>
            <input type="date" className="field" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="block text-muted">Holiday name</span>
            <input className="field" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary h-10" disabled={saving}>
            {saving ? "Saving…" : "Add holiday"}
          </button>
        </form>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
