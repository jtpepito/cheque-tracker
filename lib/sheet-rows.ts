import { isValidDate } from "./dates";
import { parseAmount } from "./money";
import type { Status } from "./types";

// One row of the sheet's Check Issuances tab, as the script sends it, turned into cheque fields.

export type SheetRow = {
  id?: unknown;
  row?: unknown;
  date?: unknown;
  supplier?: unknown;
  chequeNo?: unknown;
  amount?: unknown;
  chequeDate?: unknown;
  status?: unknown;
  reference?: unknown;
};

export type ReadRow = {
  id: string;
  row: number;
  payee: string;
  chequeNo: string;
  amount: number | null;
  issueDate: string;
  encodedDate: string | null;
  particulars: string;
  status: Status;
  /** The status cell exactly as typed in the sheet, for explaining a status change. */
  statusText: string;
};

export type RowProblem = { row: number; id: string; reason: string };

const text = (v: unknown) => (v == null ? "" : String(v).trim());

/** "YYYY-MM-DD", or M/D/YY or M/D/YYYY as typed in the sheet. Null when it is not a date. */
export function parseSheetDate(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (isValidDate(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return isValidDate(iso) ? iso : null;
}

export function statusFromSheet(raw: unknown): Status {
  const s = text(raw).toLowerCase().replace(/\s+/g, " ");
  // "for encashed" counts as settled: the owner confirmed the cash has already been withdrawn.
  if (s === "cleared" || s === "encashed" || s === "for encashed") return "cleared";
  if (s === "cancelled" || s === "returned" || s === "replaced") return "voided";
  if (s === "with christine") return "pending";
  return "issued";
}

export function readRow(
  raw: SheetRow,
  index: number,
): { ok: true; value: ReadRow } | { ok: false; problem: RowProblem } {
  const isObject = !!raw && typeof raw === "object";
  // Row 1 is the header, so the first data row is row 2.
  const row = isObject && typeof raw.row === "number" ? raw.row : index + 2;
  const id = isObject ? text(raw.id) : "";
  const bad = (reason: string) => ({ ok: false as const, problem: { row, id, reason } });
  if (!isObject) return bad("This row could not be read.");
  if (!id) return bad("This row has no Tracker ID.");

  const chequeDateText = text(raw.chequeDate);
  const issueDate = chequeDateText ? parseSheetDate(chequeDateText) : "";
  if (issueDate === null) return bad(`Cheque date "${chequeDateText}" is not a date.`);

  let amount: number | null = null;
  if (raw.amount != null && raw.amount !== "") {
    if (typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount >= 0) {
      amount = Math.round(raw.amount * 100) / 100;
    } else {
      const parsed = typeof raw.amount === "string" ? parseAmount(raw.amount) : null;
      if (parsed === null) return bad(`Amount "${text(raw.amount)}" is not an amount.`);
      amount = parsed;
    }
  }

  return {
    ok: true,
    value: {
      id,
      row,
      payee: text(raw.supplier),
      // A spreadsheet can show a numeric cheque no. as "663957.0".
      chequeNo: text(raw.chequeNo).replace(/^(\d+)\.0$/, "$1"),
      amount,
      issueDate,
      encodedDate: parseSheetDate(raw.date),
      particulars: text(raw.reference),
      status: statusFromSheet(raw.status),
      statusText: text(raw.status),
    },
  };
}
