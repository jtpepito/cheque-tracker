"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { peso } from "@/lib/money";
import type { Balance, CompanyProjection, Projection } from "@/lib/projection";
import { manilaTime } from "@/lib/sync-status";
import { companyLabel, type CompanyNames } from "@/lib/types";

function BalanceRow({ c, names, onChanged }: { c: CompanyProjection; names: CompanyNames; onChanged: () => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = companyLabel(names, c.company);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<Balance>("/api/balances", "PUT", { company: c.company, amount });
      setAmount("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  }

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-medium">{label}</p>
        {c.balance === null ? (
          <p className="text-muted">No balance entered</p>
        ) : (
          <p>
            <span className="font-mono font-semibold">{peso(c.balance)}</span>{" "}
            <span className={c.stale ? "font-medium text-danger" : "text-muted"}>
              entered {manilaTime(c.updatedAt!)}
              {c.stale ? " · more than 3 days old, check the bank" : ""}
            </span>
          </p>
        )}
      </div>
      {c.overdue > 0 && (
        <p className="text-muted">
          Earlier, not yet cleared: <span className="font-mono">{peso(c.overdue)}</span>. Taken off today&apos;s balance,
          because these cheques can still be presented.
        </p>
      )}
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-muted">Balance at the bank now (₱)</span>
          <input
            className="field"
            inputMode="decimal"
            required
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={`Bank balance for ${label}`}
            aria-invalid={!!error || undefined}
          />
        </label>
        <button type="submit" className="btn btn-primary h-10" disabled={saving}>
          {saving ? "Saving…" : "Save balance"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** Where someone who has just checked the bank types each company's balance. */
export function Balances({
  projection,
  names,
  onChanged,
}: {
  projection: Projection;
  names: CompanyNames;
  onChanged: () => Promise<void>;
}) {
  return (
    <section aria-labelledby="balances-heading" className="space-y-3 text-sm">
      <h2 id="balances-heading" className="text-lg font-semibold">
        Bank balances
      </h2>
      <p className="text-muted">
        Enter each account&apos;s balance as the bank shows it now. The calendar then takes off every cheque still marked
        issued. It does not know about deposits or other money coming in, so the real balance may be better than shown.
        Mark cheques Cleared in the sheet once the bank has paid them, or they are taken off twice.
      </p>
      <ul className="grid gap-2 lg:grid-cols-3">
        {projection.companies.map((c) => (
          <BalanceRow key={c.company} c={c} names={names} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}
