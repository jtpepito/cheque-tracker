"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { manilaTime } from "@/lib/sync-status";
import type { Role, SessionUser, User } from "@/lib/users";

type NewUser = { username: string; name: string; role: Role; password: string };
const blank: NewUser = { username: "", name: "", role: "staff", password: "" };

export function UsersAdmin() {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [draft, setDraft] = useState<NewUser>(blank);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setMe(await api<SessionUser>("/api/me"));
      setUsers(await api<User[]>("/api/users"));
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't load the users." });
      setUsers([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
      setMessage({ kind: "ok", text: label });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    run(`Added ${draft.name}. Tell them their username and starting password.`, async () => {
      await api<User>("/api/users", "POST", draft);
      setDraft(blank);
    });
  }

  function reset(u: User) {
    const next = window.prompt(`New starting password for ${u.name} (at least 8 characters). They will be signed out everywhere.`);
    if (next === null) return;
    run(`Password reset for ${u.name}.`, () => api(`/api/users/${u.id}/password`, "POST", { next }));
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        {message ? <p className="text-danger">{message.text}</p> : <p className="text-muted">Loading…</p>}
      </main>
    );
  }
  if (me.role !== "owner") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p>Only Owners can manage users.</p>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Users</h1>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>
      {me?.id === "shared" && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          You are signed in with the shared password. Create your own Owner account below, then sign out and sign in as
          yourself. The shared password stops working once an Owner account exists.
        </p>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1">
          <span className="block text-muted">Name</span>
          <input className="field" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Username</span>
          <input className="field" required maxLength={30} autoComplete="off" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Role</span>
          <select className="field" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Starting password</span>
          <input className="field" type="text" required minLength={8} autoComplete="off" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary h-10 w-full" disabled={busy}>
            Add user
          </button>
        </div>
      </form>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
          {message.text}
        </p>
      )}

      <ul className="space-y-1.5 text-sm">
        {(users ?? []).map((u) => (
          <li key={u.id} className={`grid gap-2 rounded-lg border border-line bg-card p-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-center ${u.active ? "" : "opacity-60"}`}>
            <div>
              <p className="font-medium">{u.name}</p>
              <p className="text-xs text-muted">added {manilaTime(u.createdAt)}</p>
            </div>
            <p className="font-mono">{u.username}</p>
            <p className="capitalize">{u.role}{u.active ? "" : " · off"}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn" disabled={busy} onClick={() => reset(u)}>
                Reset password
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(u.role === "owner" ? `${u.name} is now Staff.` : `${u.name} is now an Owner.`, () => api(`/api/users/${u.id}`, "PATCH", { role: u.role === "owner" ? "staff" : "owner" }))}>
                {u.role === "owner" ? "Make Staff" : "Make Owner"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => run(u.active ? `${u.name} is deactivated.` : `${u.name} is active again.`, () => api(`/api/users/${u.id}`, "PATCH", { active: !u.active }))}>
                {u.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {users && users.length === 0 && <p className="text-sm text-muted">No accounts yet.</p>}
    </main>
  );
}
