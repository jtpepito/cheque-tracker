import "server-only";
import { randomUUID } from "node:crypto";
import { getConfigJson, setConfig } from "./cheques";
import { isValidDate } from "./dates";
import { invoicesForCheque } from "./invoices";
import { parseAmount, parseBalance } from "./money";
import { TRADING, type Trading } from "./projection";
import type { Sql } from "./sql";
import type { Status } from "./types";

// Check vouchers: one per cheque, numbered per company, with the invoice lines it pays.

export type VoucherLine = {
  id: string;
  position: number;
  invoiceNo: string;
  invoiceDate: string;
  description: string;
  gross: number | null;
  ewt: number | null;
  net: number | null;
};

export type Voucher = {
  id: string;
  number: string;
  company: Trading;
  chequeId: string | null;
  voucherDate: string;
  payee: string;
  amount: number;
  preparedBy: string;
  checkedBy: string;
  approvedBy: string;
  receivedBy: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  /** Who made it and who last saved it, by name. */
  createdBy: string | null;
  updatedBy: string | null;
  lines: VoucherLine[];
};

export type VoucherSummary = Omit<Voucher, "lines"> & { chequeNo: string | null; chequeStatus: Status | null };

export type VoucherInput = {
  voucherDate: string;
  payee: string;
  amount: number;
  preparedBy: string;
  checkedBy: string;
  approvedBy: string;
  receivedBy: string;
  notes: string;
  lines: Array<Omit<VoucherLine, "id" | "position">>;
};

export class VoucherError extends Error {
  constructor(
    public code: "not_found" | "unassigned" | "kept",
    message: string,
  ) {
    super(message);
  }
}

export const SERIES_PREFIX: Record<Trading, string> = { wwj: "WWJ-CV-", wythlae: "WYT-CV-", wwjcorp: "WWJC-CV-" };

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? null : Number(v));

function toVoucher(r: Row, lines: VoucherLine[]): Voucher {
  return {
    id: r.id as string,
    number: r.number as string,
    company: r.company as Trading,
    chequeId: (r.cheque_id as string | null) ?? null,
    voucherDate: r.voucher_date as string,
    payee: r.payee as string,
    amount: Number(r.amount),
    preparedBy: r.prepared_by as string,
    checkedBy: r.checked_by as string,
    approvedBy: r.approved_by as string,
    receivedBy: r.received_by as string,
    notes: r.notes as string,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    lines,
  };
}

const toLine = (r: Row): VoucherLine => ({
  id: r.id as string,
  position: Number(r.position),
  invoiceNo: r.invoice_no as string,
  invoiceDate: r.invoice_date as string,
  description: r.description as string,
  gross: num(r.gross),
  ewt: num(r.ewt),
  net: num(r.net),
});

async function linesOf(sql: Sql, voucherId: string): Promise<VoucherLine[]> {
  return (await sql.query<Row>("SELECT * FROM voucher_lines WHERE voucher_id = $1 ORDER BY position", [voucherId])).map(toLine);
}

async function insertLines(sql: Sql, voucherId: string, lines: VoucherInput["lines"]): Promise<VoucherLine[]> {
  const out: VoucherLine[] = [];
  for (const [i, l] of lines.entries()) {
    const line: VoucherLine = { id: randomUUID(), position: i + 1, ...l };
    await sql.query(
      `INSERT INTO voucher_lines (id, voucher_id, position, invoice_no, invoice_date, description, gross, ewt, net)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [line.id, voucherId, line.position, line.invoiceNo, line.invoiceDate, line.description, line.gross, line.ewt, line.net],
    );
    out.push(line);
  }
  return out;
}

export async function getVoucher(sql: Sql, id: string): Promise<Voucher | null> {
  const row = (await sql.query<Row>("SELECT * FROM vouchers WHERE id = $1", [id]))[0];
  return row ? toVoucher(row, await linesOf(sql, id)) : null;
}

/** The cheque's voucher, made if it does not exist yet, with lines from the sheet's invoices. */
export async function createVoucherForCheque(
  sql: Sql,
  chequeId: string,
  today: string,
  now: number = Date.now(),
  by: string | null = null,
): Promise<Voucher> {
  return sql.tx(async (t) => {
    // FOR UPDATE: two "Make voucher" clicks on the same cheque at once queue here, and the second
    // then finds the first one's voucher instead of failing on the unique cheque_id.
    const cheque = (await t.query<Row>("SELECT * FROM cheques WHERE id = $1 FOR UPDATE", [chequeId]))[0];
    if (!cheque) throw new VoucherError("not_found", "This cheque no longer exists. Refresh the page.");
    const existing = (await t.query<Row>("SELECT id FROM vouchers WHERE cheque_id = $1", [chequeId]))[0];
    if (existing) return (await getVoucher(t, existing.id as string))!;
    if (!TRADING.includes(cheque.company as Trading)) {
      throw new VoucherError("unassigned", "Choose a company for this cheque first.");
    }
    const company = cheque.company as Trading;

    // The series row is locked by the UPDATE until this transaction ends, so two vouchers made
    // at the same moment get different numbers.
    await t.query("INSERT INTO voucher_series (company, last_number) VALUES ($1, 0) ON CONFLICT (company) DO NOTHING", [company]);
    const next = Number(
      (await t.query<{ last_number: unknown }>("UPDATE voucher_series SET last_number = last_number + 1 WHERE company = $1 RETURNING last_number", [company]))[0].last_number,
    );
    const id = randomUUID();
    const number = `${SERIES_PREFIX[company]}${String(next).padStart(4, "0")}`;
    await t.query(
      `INSERT INTO vouchers (id, number, company, cheque_id, voucher_date, payee, amount, created_at, updated_at, created_by, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10)`,
      [id, number, company, chequeId, today, cheque.payee, cheque.amount ?? 0, now, by, by ?? ""],
    );
    const invoices = await invoicesForCheque(t, company, cheque.cheque_no as string);
    await insertLines(
      t,
      id,
      invoices.map((r) => ({ invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, description: r.supplier, gross: r.gross, ewt: r.ewt, net: r.net })),
    );
    return (await getVoucher(t, id))!;
  });
}

export async function listVouchers(sql: Sql): Promise<VoucherSummary[]> {
  const rows = await sql.query<Row>(
    `SELECT v.*, c.cheque_no, c.status AS cheque_status FROM vouchers v LEFT JOIN cheques c ON c.id = v.cheque_id
     ORDER BY v.created_at DESC, v.number DESC`,
  );
  return rows.map((r) => {
    const { lines: _lines, ...rest } = toVoucher(r, []);
    return { ...rest, chequeNo: (r.cheque_no as string | null) ?? null, chequeStatus: (r.cheque_status as Status | null) ?? null };
  });
}

/** cheque id → voucher id, for the register's buttons. */
export async function vouchersByCheque(sql: Sql): Promise<Record<string, string>> {
  const rows = await sql.query<{ id: string; cheque_id: string }>("SELECT id, cheque_id FROM vouchers WHERE cheque_id IS NOT NULL");
  return Object.fromEntries(rows.map((r) => [r.cheque_id, r.id]));
}

const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A money field on the form: blank is null; otherwise it must read as a non-negative amount. */
function moneyField(v: unknown): number | null | undefined {
  if (v == null || v === "") return null;
  const n = parseBalance(v);
  return n === null || n < 0 ? undefined : n;
}

/** More lines than any real voucher carries; keeps one request from writing without end. */
export const MAX_VOUCHER_LINES = 200;

export function validateVoucherInput(raw: unknown): { ok: true; value: VoucherInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return { ok: false, errors: { form: "The request was not understood." } };
  const r = raw as Record<string, unknown>;
  if (!isValidDate(r.voucherDate)) errors.voucherDate = "Enter a valid voucher date.";
  const amount = parseAmount(r.amount);
  if (amount === null) errors.amount = "Enter an amount above zero.";
  if (!Array.isArray(r.lines)) errors.lines = "The lines were not understood.";
  else if (r.lines.length > MAX_VOUCHER_LINES) errors.lines = `At most ${MAX_VOUCHER_LINES} lines on a voucher.`;
  const lines: VoucherInput["lines"] = [];
  for (const [i, item] of (Array.isArray(r.lines) && r.lines.length <= MAX_VOUCHER_LINES ? r.lines : []).entries()) {
    const l = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const money = { gross: moneyField(l.gross), ewt: moneyField(l.ewt), net: moneyField(l.net) };
    for (const [key, value] of Object.entries(money)) if (value === undefined) errors[`lines.${i}.${key}`] = "Enter an amount, or leave it blank.";
    const invoiceDate = text(l.invoiceDate);
    if (invoiceDate && !isValidDate(invoiceDate)) errors[`lines.${i}.invoiceDate`] = "Enter a valid date, or leave it blank.";
    lines.push({
      invoiceNo: text(l.invoiceNo, 60),
      invoiceDate,
      description: text(l.description),
      gross: money.gross ?? null,
      ewt: money.ewt ?? null,
      net: money.net ?? null,
    });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      voucherDate: r.voucherDate as string,
      payee: text(r.payee),
      amount: amount!,
      preparedBy: text(r.preparedBy, 80),
      checkedBy: text(r.checkedBy, 80),
      approvedBy: text(r.approvedBy, 80),
      receivedBy: text(r.receivedBy, 80),
      notes: text(r.notes, 1000),
      lines,
    },
  };
}

export async function updateVoucher(
  sql: Sql,
  id: string,
  input: VoucherInput,
  now: number = Date.now(),
  by: string | null = null,
): Promise<Voucher> {
  return sql.tx(async (t) => {
    const rows = await t.query<Row>(
      `UPDATE vouchers SET voucher_date = $2, payee = $3, amount = $4, prepared_by = $5, checked_by = $6, approved_by = $7,
         received_by = $8, notes = $9, updated_at = $10, updated_by = $11 WHERE id = $1 RETURNING *`,
      [id, input.voucherDate, input.payee, input.amount, input.preparedBy, input.checkedBy, input.approvedBy, input.receivedBy, input.notes, now, by],
    );
    if (!rows[0]) throw new VoucherError("not_found", "This voucher no longer exists.");
    await t.query("DELETE FROM voucher_lines WHERE voucher_id = $1", [id]);
    const lines = await insertLines(t, id, input.lines);
    return toVoucher(rows[0], lines);
  });
}

/** Allowed while the cheque is still issued or pending; a voucher for a paid cheque is kept. */
export async function deleteVoucher(sql: Sql, id: string): Promise<void> {
  await sql.tx(async (t) => {
    const row = (await t.query<Row>("SELECT v.id, c.status FROM vouchers v LEFT JOIN cheques c ON c.id = v.cheque_id WHERE v.id = $1", [id]))[0];
    if (!row) throw new VoucherError("not_found", "This voucher no longer exists.");
    if (row.status === "cleared" || row.status === "voided") throw new VoucherError("kept", "This cheque has been paid; its voucher is kept.");
    await t.query("DELETE FROM vouchers WHERE id = $1", [id]);
  });
}

export type CompanyDetails = Record<Trading, { address: string; tin: string }>;
const BLANK: CompanyDetails = { wwj: { address: "", tin: "" }, wythlae: { address: "", tin: "" }, wwjcorp: { address: "", tin: "" } };

export async function getCompanyDetails(sql: Sql): Promise<CompanyDetails> {
  const saved = (await getConfigJson<Partial<CompanyDetails>>(sql, "company_details")) ?? {};
  return { wwj: { ...BLANK.wwj, ...saved.wwj }, wythlae: { ...BLANK.wythlae, ...saved.wythlae }, wwjcorp: { ...BLANK.wwjcorp, ...saved.wwjcorp } };
}

export async function setCompanyDetails(sql: Sql, details: CompanyDetails): Promise<CompanyDetails> {
  const clean = Object.fromEntries(
    TRADING.map((co) => [co, { address: text(details[co]?.address, 300), tin: text(details[co]?.tin, 40) }]),
  ) as CompanyDetails;
  await setConfig(sql, "company_details", JSON.stringify(clean));
  return clean;
}
