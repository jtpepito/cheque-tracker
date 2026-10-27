"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setMessage({ kind: "error", text: "The new passwords do not match." });
    try {
      await api("/api/me/password", "PUT", { current, next });
      setCurrent("");
      setNext("");
      setAgain("");
      setMessage({ kind: "ok", text: "Password changed." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Change password
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-line bg-card p-3 text-sm">
      <label className="space-y-1">
        <span className="block text-muted">Current password</span>
        <input className="field" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">New password</span>
        <input className="field" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="space-y-1">
        <span className="block text-muted">New password again</span>
        <input className="field" type="password" autoComplete="new-password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      <button type="submit" className="btn btn-primary h-10">
        Save
      </button>
      <button type="button" className="btn h-10" onClick={() => setOpen(false)}>
        Close
      </button>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`w-full ${message.kind === "error" ? "text-danger" : ""}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
