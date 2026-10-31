import "server-only";
import { mentionsNumber } from "./company-rules";
import { parseBalance } from "./money";
import type { Trading } from "./projection";
import { MAX_SHEET_TEXT, parseSheetDate } from "./sheet-rows";
import type { Sql } from "./sql";

// Each company's SI and DR tabs from the sheet: one row per supplier invoice or delivery receipt,
// with the cheque that paid it named in "Payment Details". Replaced on every sync; used only to
// suggest a voucher's lines.

export type InvoiceRow = {
  company: Trading;
  /** The sheet tab the row is on ("" from an older sheet script). */
  tab: string;
  row: number;
  invoiceDate: string;
  invoiceNo: string;
  supplier: string;
  gross: number | null;
  paymentDetails: string;
  ewt: number | null;
  net: number | null;
};

// Payment Details may list several payments, so it gets more room than the other cells.
const MAX_PAYMENT_DETAILS = 1000;
const text = (v: unknown, max = MAX_SHEET_TEXT) => (v == null ? "" : String(v).trim().slice(0, max));

/** A money cell: a number, or text like "₱582.86"; blank or unreadable becomes null. */
function money(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? Math.round(v * 100) / 100 : parseBalance(v);
  // Negative or too large for the column: left blank rather than failing the whole sync.
  return n === null || n < 0 || n >= 1e12 ? null : n;
}

export function readInvoiceRows(company: Trading, raw: unknown): InvoiceRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: InvoiceRow[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const r = item as Record<string, unknown>;
    const invoiceNo = text(r.invoiceNo);
    const supplier = text(r.supplier);
    const gross = money(r.gross);
    if (!invoiceNo && !supplier && gross === null) return;
    rows.push({
      company,
      tab: text(r.tab),
      row: typeof r.row === "number" ? r.row : index + 2,
      invoiceDate: parseSheetDate(r.date) ?? "",
      invoiceNo,
      supplier,
      gross,
      paymentDetails: text(r.paymentDetails, MAX_PAYMENT_DETAILS),
      ewt: money(r.ewt),
      net: money(r.net),
    });
  });
  return rows;
}

const toRow = (r: Record<string, unknown>): InvoiceRow => ({
  company: r.company as Trading,
  tab: r.tab as string,
  row: Number(r.row),
  invoiceDate: r.invoice_date as string,
  invoiceNo: r.invoice_no as string,
  supplier: r.supplier as string,
  gross: r.gross == null ? null : Number(r.gross),
  paymentDetails: r.payment_details as string,
  ewt: r.ewt == null ? null : Number(r.ewt),
  net: r.net == null ? null : Number(r.net),
});

/** Replaces the whole table with these rows. */
export async function replaceInvoices(sql: Sql, rows: InvoiceRow[]): Promise<void> {
  await sql.query("DELETE FROM invoices");
  for (const r of rows) {
    await sql.query(
      `INSERT INTO invoices (company, tab, row, invoice_date, invoice_no, supplier, gross, payment_details, ewt, net)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (company, tab, row) DO UPDATE SET invoice_date = excluded.invoice_date, invoice_no = excluded.invoice_no,
         supplier = excluded.supplier, gross = excluded.gross, payment_details = excluded.payment_details,
         ewt = excluded.ewt, net = excluded.net`,
      [r.company, r.tab, r.row, r.invoiceDate, r.invoiceNo, r.supplier, r.gross, r.paymentDetails, r.ewt, r.net],
    );
  }
}

export async function listInvoices(sql: Sql, company: Trading): Promise<InvoiceRow[]> {
  return (await sql.query<Record<string, unknown>>("SELECT * FROM invoices WHERE company = $1 ORDER BY tab, row", [company])).map(toRow);
}

/**
 * The invoices this cheque pays, from its own company's tabs, in sheet order within each tab.
 * A row with no invoice number of its own takes `fallbackNo`: the cheque's "CR No./ SI No." note,
 * which is where staff write the supplier's document number (e.g. "AGC No. 011588") for DR rows.
 */
export async function invoicesForCheque(sql: Sql, company: Trading, chequeNo: string, fallbackNo = ""): Promise<InvoiceRow[]> {
  if (!chequeNo) return [];
  return (await listInvoices(sql, company))
    .filter((r) => mentionsNumber(r.paymentDetails, chequeNo))
    .map((r) => (r.invoiceNo ? r : { ...r, invoiceNo: fallbackNo.trim() }));
}
