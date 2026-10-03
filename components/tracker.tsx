"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { buildCalendar } from "@/lib/calendar";
import type { Cheque, CompanyNames } from "@/lib/types";
import { ChequeForm } from "./cheque-form";
import { FundingCalendar } from "./funding-calendar";
import { Header } from "./header";
import { Register } from "./register";

type State = { today: string; companies: CompanyNames; cheques: Cheque[] };

const REFRESH_MS = 30_000;

export function Tracker() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setProblem(null);
    } catch (err) {
      // Keep showing the last data; the next cycle tries again.
      setProblem(err instanceof ApiError ? err.message : "Couldn't refresh.");
    }
  }, []);

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
      <FundingCalendar days={buildCalendar(state.cheques, state.today)} names={state.companies} />
      <ChequeForm key={state.today} today={state.today} names={state.companies} onSaved={refresh} />
      <Register cheques={state.cheques} names={state.companies} onChanged={refresh} />
    </main>
  );
}
