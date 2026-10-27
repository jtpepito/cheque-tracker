"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { DEFAULT_COMPANY_NAMES, companyLabel, type CompanyNames } from "@/lib/types";
import type { VoucherSummary } from "@/lib/vouchers";

export function VouchersList() {
  const [list, setList] = useState<VoucherSummary[] | null>(null);
  const [names, setNames] = useState<CompanyNames>(DEFAULT_COMPANY_NAMES);
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api<{ vouchers: VoucherSummary[]; names: CompanyNames }>("/api/vouchers").then(
      (r) => {
        setList(r.vouchers);
        setNames(r.names);
      },
      (err) => setProblem(err instanceof ApiError ? err.message : "Couldn't load the vouchers."));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (v) => !q || v.payee.toLowerCase().includes(q) || v.number.toLowerCase().includes(q) || (v.chequeNo ?? "").toLowerCase().includes(q),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Check vouchers</h1>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>
      <p className="text-sm text-muted">A voucher is made from a cheque: use the Voucher button on a cheque in the register.</p>
      <input
        className="field max-w-md"
        placeholder="Search by payee, cheque no. or voucher no."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search vouchers"
      />
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {list && shown.length === 0 && <p className="text-sm text-muted">{list.length === 0 ? "No vouchers yet." : "No vouchers match."}</p>}
      <ul className="space-y-1.5 text-sm">
        {shown.map((v) => (
          <li key={v.id}>
            <Link
              href={`/vouchers/${v.id}`}
              className="grid gap-x-3 gap-y-1 rounded-lg border border-line bg-card p-3 hover:border-accent sm:grid-cols-[9rem_6rem_minmax(0,1fr)_8rem_9rem]"
            >
              <span className="font-mono font-medium">{v.number}</span>
              <span>{shortDate(v.voucherDate)}</span>
              <span className="truncate">{v.payee || "(no payee)"}</span>
              <span className="font-mono sm:text-right">{peso(v.amount)}</span>
              <span className="text-muted">
                {companyLabel(names, v.company)} · {v.chequeNo ?? "no cheque"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
