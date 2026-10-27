"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import type { InvoiceRow } from "@/lib/invoices";
import { peso, sumAmounts } from "@/lib/money";
import type { Status } from "@/lib/types";
import type { Voucher, VoucherLine } from "@/lib/vouchers";
import { amountInWords } from "@/lib/words";

type View = {
  voucher: Voucher;
  cheque: { chequeNo: string; bankAccount: string; issueDate: string; status: Status } | null;
  companyName: string;
  details: { address: string; tin: string };
};

type LineDraft = { invoiceNo: string; invoiceDate: string; description: string; gross: string; ewt: string; net: string };
type Draft = {
  voucherDate: string; payee: string; amount: string; preparedBy: string; checkedBy: string; approvedBy: string; receivedBy: string; notes: string;
  lines: LineDraft[];
};

const money = (n: number | null) => (n === null ? "" : String(n));
const toDraft = (v: Voucher): Draft => ({
  voucherDate: v.voucherDate, payee: v.payee, amount: String(v.amount), preparedBy: v.preparedBy, checkedBy: v.checkedBy,
  approvedBy: v.approvedBy, receivedBy: v.receivedBy, notes: v.notes,
  lines: v.lines.map((l) => ({ invoiceNo: l.invoiceNo, invoiceDate: l.invoiceDate, description: l.description, gross: money(l.gross), ewt: money(l.ewt), net: money(l.net) })),
});
const blankLine = (): LineDraft => ({ invoiceNo: "", invoiceDate: "", description: "", gross: "", ewt: "", net: "" });
const asNumber = (s: string) => {
  const n = Number(s.replace(/[₱,\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};

export function VoucherEditor({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<View>(`/api/vouchers/${id}`).then(
      (v) => {
        setView(v);
        setDraft(toDraft(v.voucher));
      },
      (err) => setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't load the voucher." }),
    );
  }, [id]);

  if (!view || !draft) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p role={message ? "alert" : "status"}>{message?.text ?? "Loading…"}</p>
      </main>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const setLine = (i: number, key: keyof LineDraft, value: string) =>
    setDraft({ ...draft, lines: draft.lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)) });
  const amount = asNumber(draft.amount) ?? 0;
  const netTotal = sumAmounts(draft.lines.map((l) => asNumber(l.net)));
  const mismatch = draft.lines.length > 0 && Math.round(netTotal * 100) !== Math.round(amount * 100);

  async function save() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const saved = await api<Voucher>(`/api/vouchers/${id}`, "PUT", draft);
      setView({ ...view!, voucher: saved });
      setDraft(toDraft(saved));
      setMessage({ kind: "ok", text: "Saved." });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors ?? {});
        setMessage({ kind: "error", text: err.message });
      } else setMessage({ kind: "error", text: "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  async function fillFromSheet() {
    if (!view!.voucher.chequeId) return;
    setBusy(true);
    setMessage(null);
    try {
      const rows = await api<InvoiceRow[]>(`/api/invoices?chequeId=${encodeURIComponent(view!.voucher.chequeId)}`);
      if (rows.length === 0) setMessage({ kind: "error", text: "The sheet has no invoice naming this cheque number." });
      else {
        set(
          "lines",
          rows.map((r) => ({ invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, description: r.supplier, gross: money(r.gross), ewt: money(r.ewt), net: money(r.net) })),
        );
        setMessage({ kind: "ok", text: `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} filled in from the sheet. Save to keep them.` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Delete voucher ${view!.voucher.number}? Its number will not be reused.`)) return;
    setBusy(true);
    try {
      await api(`/api/vouchers/${id}`, "DELETE");
      router.push("/vouchers");
      return;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  const v = view.voucher;
  const cheque = view.cheque;
  const canDelete = !cheque || cheque.status === "issued" || cheque.status === "pending";
  const field = (key: keyof Omit<Draft, "lines">, label: string, type = "text") => (
    <label className="space-y-1 text-sm">
      <span className="block text-muted">{label}</span>
      <input type={type} className="field" value={draft[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key] || undefined} />
      {errors[key] && <span className="block text-danger">{errors[key]}</span>}
    </label>
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="print-hide flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Voucher {v.number}</h1>
        <Link href="/vouchers" className="btn">
          All vouchers
        </Link>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>

      <section className="print-hide space-y-3 rounded-xl border border-line bg-card p-4">
        {cheque ? (
          <p className="text-sm text-muted">
            Cheque {cheque.chequeNo || "(no number)"} · {cheque.issueDate ? shortDate(cheque.issueDate) : "no date"} · {cheque.status}
            {cheque.bankAccount ? ` · ${cheque.bankAccount}` : ""}
          </p>
        ) : (
          <p className="text-sm text-warn-ink">This cheque is no longer in the sheet.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("voucherDate", "Voucher date", "date")}
          {field("payee", "Payee")}
          {field("amount", "Amount (₱)")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("preparedBy", "Prepared by")}
          {field("checkedBy", "Checked by")}
          {field("approvedBy", "Approved by")}
          {field("receivedBy", "Received by")}
        </div>
        <label className="block space-y-1 text-sm">
          <span className="block text-muted">Notes (printed under the particulars)</span>
          <textarea className="field h-20 py-2" value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Particulars</h2>
          <button type="button" className="btn" disabled={busy || !v.chequeId} onClick={fillFromSheet}>
            Fill from sheet
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => set("lines", [...draft.lines, blankLine()])}>
            Add line
          </button>
        </div>
        {draft.lines.length === 0 && <p className="text-sm text-muted">No lines yet. Fill from the sheet, or add a line.</p>}
        <ul className="space-y-2">
          {draft.lines.map((l, i) => (
            <li key={i} className="grid gap-2 rounded-lg border border-line p-2 text-sm sm:grid-cols-[7rem_8rem_minmax(0,1fr)_7rem_6rem_7rem_auto] sm:items-center">
              <input className="field" placeholder="Invoice no." value={l.invoiceNo} onChange={(e) => setLine(i, "invoiceNo", e.target.value)} aria-label={`Line ${i + 1} invoice no.`} />
              <input className="field" type="date" value={l.invoiceDate} onChange={(e) => setLine(i, "invoiceDate", e.target.value)} aria-label={`Line ${i + 1} date`} aria-invalid={!!errors[`lines.${i}.invoiceDate`] || undefined} />
              <input className="field" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} aria-label={`Line ${i + 1} description`} />
              <input className="field" placeholder="Gross" value={l.gross} onChange={(e) => setLine(i, "gross", e.target.value)} aria-label={`Line ${i + 1} gross`} aria-invalid={!!errors[`lines.${i}.gross`] || undefined} />
              <input className="field" placeholder="EWT" value={l.ewt} onChange={(e) => setLine(i, "ewt", e.target.value)} aria-label={`Line ${i + 1} EWT`} aria-invalid={!!errors[`lines.${i}.ewt`] || undefined} />
              <input className="field" placeholder="Net" value={l.net} onChange={(e) => setLine(i, "net", e.target.value)} aria-label={`Line ${i + 1} net`} aria-invalid={!!errors[`lines.${i}.net`] || undefined} />
              <button type="button" className="btn" onClick={() => set("lines", draft.lines.filter((_, n) => n !== i))} aria-label={`Remove line ${i + 1}`}>
                Remove
              </button>
              {Object.entries(errors)
                .filter(([k]) => k.startsWith(`lines.${i}.`))
                .map(([k, text]) => (
                  <span key={k} className="text-danger sm:col-span-7">
                    {text}
                  </span>
                ))}
            </li>
          ))}
        </ul>
        {mismatch && (
          <p className="text-sm text-warn-ink">
            The lines' net total is {peso(netTotal)}, but the voucher amount is {peso(amount)}. You can still print; check the figures.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary h-10 px-5" disabled={busy} onClick={save}>
            {busy ? "Working…" : "Save"}
          </button>
          <button type="button" className="btn h-10" onClick={() => window.print()}>
            Print
          </button>
          {canDelete && (
            <button type="button" className="btn h-10" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
              {message.text}
            </p>
          )}
        </div>
      </section>

      {/* The printed voucher. Shows the draft, so what you see is what prints. */}
      <section className="voucher-sheet mx-auto max-w-[190mm] space-y-4 rounded-xl border border-line bg-white p-8 text-sm text-black">
        <header className="text-center">
          <p className="text-lg font-semibold">{view.companyName}</p>
          {view.details.address && <p>{view.details.address}</p>}
          {view.details.tin && <p>TIN {view.details.tin}</p>}
          <p className="mt-2 text-base font-semibold tracking-wide">CHECK VOUCHER</p>
        </header>
        <div className="flex justify-between">
          <p>
            <span className="text-neutral-600">CV No.</span> <span className="font-mono font-semibold">{v.number}</span>
          </p>
          <p>
            <span className="text-neutral-600">Date</span> {draft.voucherDate ? shortDate(draft.voucherDate) + " " + draft.voucherDate.slice(0, 4) : ""}
          </p>
        </div>
        <p>
          <span className="text-neutral-600">Pay to</span> <span className="font-semibold">{draft.payee}</span>
        </p>
        <p>
          <span className="text-neutral-600">Amount</span> <span className="font-mono font-semibold">{peso(amount)}</span>
        </p>
        <p className="text-xs uppercase">{amount > 0 && amount < 1e12 ? amountInWords(amount) : ""}</p>
        {cheque && (
          <p>
            <span className="text-neutral-600">Cheque no.</span> {cheque.chequeNo || "—"}
            {cheque.bankAccount ? <> · {cheque.bankAccount}</> : null}
            {cheque.issueDate ? <> · dated {shortDate(cheque.issueDate)} {cheque.issueDate.slice(0, 4)}</> : null}
          </p>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">Invoice no.</th>
              <th className="py-1 pr-2">Date</th>
              <th className="py-1 pr-2">Particulars</th>
              <th className="py-1 pr-2 text-right">Gross</th>
              <th className="py-1 pr-2 text-right">EWT</th>
              <th className="py-1 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-300 align-top">
                <td className="py-1 pr-2 font-mono">{l.invoiceNo}</td>
                <td className="py-1 pr-2">{l.invoiceDate ? shortDate(l.invoiceDate) + " " + l.invoiceDate.slice(0, 4) : ""}</td>
                <td className="py-1 pr-2">{l.description}</td>
                <td className="py-1 pr-2 text-right font-mono">{asNumber(l.gross) === null ? "" : peso(asNumber(l.gross)!)}</td>
                <td className="py-1 pr-2 text-right font-mono">{asNumber(l.ewt) === null ? "" : peso(asNumber(l.ewt)!)}</td>
                <td className="py-1 text-right font-mono">{asNumber(l.net) === null ? "" : peso(asNumber(l.net)!)}</td>
              </tr>
            ))}
            {draft.lines.length > 0 && (
              <tr className="font-semibold">
                <td colSpan={5} className="py-1 pr-2 text-right">
                  Total
                </td>
                <td className="py-1 text-right font-mono">{peso(netTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 pt-6 sm:grid-cols-4">
          {(["preparedBy", "checkedBy", "approvedBy", "receivedBy"] as const).map((key, i) => (
            <div key={key} className="border-t border-black pt-1">
              <p className="text-xs text-neutral-600">{["Prepared by", "Checked by", "Approved by", "Received by"][i]}</p>
              <p className="min-h-5 font-medium">{draft[key]}</p>
              <p className="text-xs text-neutral-600">Signature / date</p>
            </div>
          ))}
        </div>
        <p className="pt-4 text-xs">
          Received from {view.companyName} the amount of {peso(amount)} in full payment of the above.
          <span className="ml-2 inline-block w-48 border-b border-black align-bottom" /> Payee / date
        </p>
      </section>
    </main>
  );
}
