"use client";

import Image from "next/image";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import { api, ApiError } from "@/lib/api";
import type { CompanyNames } from "@/lib/types";
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

export function Header({ names, onChanged }: { names: CompanyNames; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<CompanyNames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api<CompanyNames>("/api/companies", "PUT", draft);
      await onChanged();
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  }

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Image src={logo} alt="Wythlae" width={48} height={48} priority className="h-12 w-12 shrink-0 rounded-full" />
        <h1 className="mr-auto text-2xl font-semibold">Cheque Funding Tracker</h1>
        <button type="button" className="btn" onClick={toggleTheme}>
          Light / dark
        </button>
        <form action={logout}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </div>
      {draft ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          {KEYS.map((key) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="block text-muted">Company name</span>
              <input
                className="field"
                required
                maxLength={60}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit" className="btn btn-primary h-10" disabled={saving}>
            {saving ? "Saving…" : "Save names"}
          </button>
          <button type="button" className="btn h-10" onClick={() => setDraft(null)}>
            Cancel
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {KEYS.map((key) => (
            <span key={key} className="rounded-full bg-mint px-3 py-1">
              {names[key]}
            </span>
          ))}
          <button type="button" className="btn" onClick={() => setDraft(names)}>
            Edit names
          </button>
        </div>
      )}
    </header>
  );
}
