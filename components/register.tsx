"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { clearingDate, type Holiday } from "@/lib/banking";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { DEFAULT_FILTERS, filterAndSort, issuedSummary, unassignedSummary, type Filters } from "@/lib/register";
import { nextStatuses } from "@/lib/rules";
import { COMPANIES, STATUSES, companyLabel, type Cheque, type Company, type CompanyNames, type Status } from "@/lib/types";

const ACTION_LABEL: Record<Status, string> = {
  pending: "Mark pending",
  issued: "Mark issued",
  cleared: "Mark cleared",
  voided: "Void",
};

const GRID = "md:grid md:grid-cols-[7rem_10rem_8rem_minmax(0,1fr)_8rem_5rem_11rem] md:items-center md:gap-3";

export function Register({
  cheques,
  names,
  holidays,
  onChanged,
}: {
  cheques: Cheque[];
  names: CompanyNames;
  holidays: Holiday[];
  onChanged: () => Promise<void>;
}) {
  const holidayDates = new Set(holidays.map((h) => h.date));
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const rows = filterAndSort(cheques, filters);
  const issued = issuedSummary(cheques);
  const unassigned = unassignedSummary(cheques);

  async function change(id: string, body: { status: Status } | { company: Company }) {
    setBusy(id);
    setRowError(null);
    try {
      await api<Cheque>(`/api/cheques/${encodeURIComponent(id)}`, "PATCH", body);
    } catch (err) {
      const c = cheques.find((x) => x.id === id);
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setRowError({ id, message: c ? `Cheque ${c.chequeNo || "(no number)"}, ${c.payee}: ${message}` : message });
    }
    // Refresh either way: after a refusal the row shows what someone else already did.
    await onChanged();
    setBusy(null);
  }

  return (
    <section aria-labelledby="register-heading" className="space-y-3">
      <h2 id="register-heading" className="text-lg font-semibold">
        Register
      </h2>
      <p className="text-sm">
        Issued, not yet cleared: <strong>{peso(issued.total)}</strong> across {issued.count}{" "}
        {issued.count === 1 ? "cheque" : "cheques"}.
      </p>
      {unassigned.count > 0 && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          {unassigned.count} outstanding {unassigned.count === 1 ? "cheque has" : "cheques have"} no company (
          {peso(unassigned.total)}). Choose a company for each from its dropdown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-muted">Company</span>
          <select
            className="field"
            value={filters.company}
            onChange={(e) => setFilters({ ...filters, company: e.target.value as Filters["company"] })}
          >
            <option value="all">All companies</option>
            {COMPANIES.map((co) => (
              <option key={co} value={co}>
                {companyLabel(names, co)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Status</span>
          <select
            className="field"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2">
          <input
            type="checkbox"
            checked={filters.hideSettled}
            onChange={(e) => setFilters({ ...filters, hideSettled: e.target.checked })}
          />
          Hide cleared &amp; voided
        </label>
        <span className="ml-auto text-muted">
          {rows.length} {rows.length === 1 ? "cheque" : "cheques"} shown
        </span>
      </div>

      {/* Shown above the list, not in the row: a refused row may now be hidden by the filters. */}
      {rowError && (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">
          {rowError.message}
        </p>
      )}

      <div className={`hidden px-3 text-xs font-medium text-muted ${GRID}`}>
        <span>Cheque date</span>
        <span>Company</span>
        <span>Cheque no.</span>
        <span>Payee</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">No cheques match these filters.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c) => (
            <li
              key={c.id}
              className={`space-y-2 rounded-lg border p-3 text-sm md:space-y-0 ${GRID} ${
                c.company === "unassigned" ? "border-warn-ink/40 bg-warn" : "border-line bg-card"
              }`}
            >
              <div>
                <p className="font-medium">{c.issueDate ? shortDate(c.issueDate) : "No date"}</p>
                {c.issueDate && <p className="text-xs text-muted">{c.issueDate.slice(0, 4)}</p>}
                {(c.status === "issued" || c.status === "pending") &&
                  clearingDate(c.issueDate, holidayDates) !== c.issueDate && (
                    <p className="text-xs font-medium">Clears {shortDate(clearingDate(c.issueDate, holidayDates))}</p>
                  )}
                {c.encodedDate && c.encodedDate !== c.issueDate && (
                  <p className="text-xs text-muted">Logged {shortDate(c.encodedDate)}</p>
                )}
              </div>
              <select
                aria-label={`Company for cheque ${c.chequeNo}`}
                className="field"
                value={c.company}
                disabled={busy === c.id}
                onChange={(e) => change(c.id, { company: e.target.value as Company })}
              >
                {COMPANIES.map((co) => (
                  <option key={co} value={co}>
                    {companyLabel(names, co)}
                  </option>
                ))}
              </select>
              <p className="font-mono break-all">{c.chequeNo}</p>
              <div className="min-w-0">
                <p className="break-words font-medium">{c.payee}</p>
                {(c.particulars || c.bankAccount) && (
                  <p className="break-words text-xs text-muted">
                    {[c.particulars, c.bankAccount].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <p className="font-mono md:text-right">{c.amount === null ? "—" : peso(c.amount)}</p>
              <p className="capitalize">{c.status}</p>
              <div className="flex flex-wrap gap-1.5">
                {nextStatuses(c.status).map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={`btn ${to === "voided" ? "" : "btn-primary"}`}
                    disabled={busy === c.id}
                    onClick={() => change(c.id, { status: to })}
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
