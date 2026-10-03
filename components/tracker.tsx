"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Holiday } from "@/lib/banking";
import { buildCalendar } from "@/lib/calendar";
import { latestOnly } from "@/lib/latest";
import type { SyncReport } from "@/lib/sync";
import type { Cheque, CompanyNames } from "@/lib/types";
import { FundingCalendar } from "./funding-calendar";
import { Header } from "./header";
import { Holidays } from "./holidays";
import { Register } from "./register";
import { SyncStatus } from "./sync-status";

type State = {
  today: string;
  now: number;
  companies: CompanyNames;
  holidays: Holiday[];
  sync: SyncReport | null;
  cheques: Cheque[];
};

const REFRESH_MS = 30_000;

export function Tracker() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A 30-second poll that lands after a newer refresh must not put older data back.
  const track = useRef(latestOnly()).current;

  const refresh = useCallback(async () => {
    try {
      const res = await track(api<State>("/api/state"));
      if (!res.fresh) return;
      setState(res.value);
      setProblem(null);
    } catch (err) {
      // Keep showing the last data; the next cycle tries again.
      setProblem(err instanceof ApiError ? err.message : "Couldn't refresh.");
    }
  }, [track]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <p role={problem ? "alert" : "status"}>{problem ?? "Loading cheques…"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <Header names={state.companies} onChanged={refresh} />
      {problem && (
        <p role="alert" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          {problem} Showing the last data loaded; trying again shortly.
        </p>
      )}
      <SyncStatus sync={state.sync} now={state.now} />
      <FundingCalendar days={buildCalendar(state.cheques, state.today, state.holidays)} names={state.companies} />
      <Register cheques={state.cheques} names={state.companies} holidays={state.holidays} onChanged={refresh} />
      <Holidays holidays={state.holidays} today={state.today} onChanged={refresh} />
    </main>
  );
}
