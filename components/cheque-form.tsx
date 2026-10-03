"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { COMPANIES, companyLabel, type Cheque, type Company, type CompanyNames } from "@/lib/types";

type Fields = {
  company: Company;
  chequeNo: string;
  payee: string;
  amount: string;
  issueDate: string;
  bankAccount: string;
  particulars: string;
  status: "issued" | "pending";
};

const blank = (today: string, company: Company = "wwj"): Fields => ({
  company,
  chequeNo: "",
  payee: "",
  amount: "",
  issueDate: today,
  bankAccount: "",
  particulars: "",
  status: "issued",
});

export function ChequeForm({
  today,
  names,
  onSaved,
}: {
  today: string;
  names: CompanyNames;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState<Fields>(() => blank(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setF((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const saved = await api<Cheque>("/api/cheques", "POST", f);
      setMessage({ kind: "ok", text: `Saved cheque ${saved.chequeNo}.` });
      setF(blank(today, f.company));
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors ?? {});
        setMessage({ kind: "error", text: err.message });
      } else setMessage({ kind: "error", text: "Something went wrong. Try again." });
    }
    setSaving(false);
  }

  const text = (key: "chequeNo" | "payee" | "amount" | "bankAccount" | "particulars", label: string, extra = {}) => (
    <label className="space-y-1 text-sm">
      <span className="block text-muted">{label}</span>
      <input
        className="field"
        value={f[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={!!errors[key] || undefined}
        {...extra}
      />
      {errors[key] && <span className="block text-danger">{errors[key]}</span>}
    </label>
  );

  return (
    <section aria-labelledby="form-heading" className="space-y-3">
      <h2 id="form-heading" className="text-lg font-semibold">
        New cheque
      </h2>
      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Company</span>
          <select className="field" value={f.company} onChange={(e) => set("company", e.target.value as Company)}>
            {COMPANIES.map((co) => (
              <option key={co} value={co}>
                {companyLabel(names, co)}
              </option>
            ))}
          </select>
          {errors.company && <span className="block text-danger">{errors.company}</span>}
        </label>
        {text("chequeNo", "Cheque no.", { required: true })}
        {text("payee", "Payee", { required: true })}
        {text("amount", "Amount (₱)", { required: true, inputMode: "decimal", placeholder: "0.00" })}
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Cheque date</span>
          <input
            type="date"
            className="field"
            required
            value={f.issueDate}
            onChange={(e) => set("issueDate", e.target.value)}
            aria-invalid={!!errors.issueDate || undefined}
          />
          {errors.issueDate && <span className="block text-danger">{errors.issueDate}</span>}
        </label>
        {text("bankAccount", "Bank account (optional)", { placeholder: "BDO Current 1234" })}
        {text("particulars", "Particulars (CR / SI / DR)")}
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Status</span>
          <select className="field" value={f.status} onChange={(e) => set("status", e.target.value as Fields["status"])}>
            <option value="issued">Issued</option>
            <option value="pending">Pending</option>
          </select>
          {errors.status && <span className="block text-danger">{errors.status}</span>}
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn btn-primary h-10 px-5" disabled={saving}>
            {saving ? "Saving…" : "Save cheque"}
          </button>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
