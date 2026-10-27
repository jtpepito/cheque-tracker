"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import { api, ApiError } from "@/lib/api";
import type { CompanyNames } from "@/lib/types";
import type { SessionUser } from "@/lib/users";
import type { CompanyDetails } from "@/lib/vouchers";
import { ChangePassword } from "./change-password";
import logo from "@/public/logo.png";

const KEYS = ["wwj", "wythlae", "wwjcorp"] as const;

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Private windows may block storage; the choice then lasts until the page is closed.
  }
}

type Draft = { names: CompanyNames; details: CompanyDetails };

export function Header({
  me,
  names,
  details,
  onChanged,
}: {
  me: SessionUser;
  names: CompanyNames;
  details: CompanyDetails;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api<CompanyNames>("/api/companies", "PUT", draft.names);
      await api<CompanyDetails>("/api/company-details", "PUT", draft.details);
      await onChanged();
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  }

  const setDetail = (key: (typeof KEYS)[number], field: "address" | "tin", value: string) =>
    setDraft((d) => d && { ...d, details: { ...d.details, [key]: { ...d.details[key], [field]: value } } });

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Image src={logo} alt="Wythlae and WWJ Trading Corporation" priority className="h-12 w-auto shrink-0 rounded-lg" />
        <h1 className="mr-auto text-2xl font-semibold text-accent">Cheque Funding Tracker</h1>
        <span className="text-sm text-muted">{me.name}</span>
        {me.role === "owner" && (
          <Link href="/users" className="btn">
            Users
          </Link>
        )}
        <Link href="/vouchers" className="btn">
          Vouchers
        </Link>
        <button type="button" className="btn" onClick={toggleTheme}>
          Light / dark
        </button>
        <form action={logout}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
        {me.id !== "shared" && <ChangePassword />}
      </div>
      {draft ? (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-line bg-card p-4 text-sm">
          <p className="text-muted">The name shows everywhere; the address and TIN print on that company&apos;s vouchers.</p>
          {KEYS.map((key) => (
            <div key={key} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr]">
              <label className="space-y-1">
                <span className="block text-muted">Company name</span>
                <input
                  className="field"
                  required
                  maxLength={60}
                  value={draft.names[key]}
                  onChange={(e) => setDraft({ ...draft, names: { ...draft.names, [key]: e.target.value } })}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-muted">Address</span>
                <input className="field" maxLength={300} value={draft.details[key].address} onChange={(e) => setDetail(key, "address", e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="block text-muted">TIN</span>
                <input className="field" maxLength={40} value={draft.details[key].tin} onChange={(e) => setDetail(key, "tin", e.target.value)} />
              </label>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary h-10" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn h-10" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {KEYS.map((key) => (
            <span key={key} className="rounded-full bg-mint px-3 py-1">
              {names[key]}
            </span>
          ))}
          <button type="button" className="btn" onClick={() => setDraft({ names, details })}>
            Edit names
          </button>
        </div>
      )}
    </header>
  );
}
