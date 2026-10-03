import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { Holiday } from "./banking";
import { DEFAULT_COMPANY_NAMES, type Cheque, type Company, type CompanyNames, type Status } from "./types";

export class ChequeError extends Error {
  constructor(
    public code: "not_found",
    message: string,
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;

function toCheque(r: Row): Cheque {
  return {
    id: r.id as string,
    company: r.company as Company,
    chequeNo: r.cheque_no as string,
    payee: r.payee as string,
    amount: (r.amount as number | null) ?? null,
    issueDate: r.issue_date as string,
    encodedDate: (r.encoded_date as string | null) ?? null,
    bankAccount: r.bank_account as string,
    particulars: r.particulars as string,
    status: r.status as Status,
    createdAt: Number(r.created_at),
    imported: Number(r.imported) === 1,
    companyBasis: (r.company_basis as string | null) ?? null,
    sourceRow: r.source_row == null ? null : Number(r.source_row),
    companyLocked: Number(r.company_locked) === 1,
  };
}

export function listCheques(db: DatabaseSync): Cheque[] {
  return (db.prepare("SELECT * FROM cheques ORDER BY issue_date, cheque_no").all() as Row[]).map(toCheque);
}

function getCheque(db: DatabaseSync, id: string): Cheque {
  const row = db.prepare("SELECT * FROM cheques WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new ChequeError("not_found", "This cheque no longer exists. Refresh the page.");
  return toCheque(row);
}

/** Inserts the cheque, or replaces every field of the row with the same id. */
export function upsertCheque(db: DatabaseSync, c: Cheque): void {
  db.prepare(
    `INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, encoded_date, bank_account,
                          particulars, status, created_at, imported, company_basis, source_row, company_locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       company = excluded.company, cheque_no = excluded.cheque_no, payee = excluded.payee,
       amount = excluded.amount, issue_date = excluded.issue_date, encoded_date = excluded.encoded_date,
       bank_account = excluded.bank_account, particulars = excluded.particulars, status = excluded.status,
       created_at = excluded.created_at, imported = excluded.imported,
       company_basis = excluded.company_basis, source_row = excluded.source_row,
       company_locked = excluded.company_locked`,
  ).run(
    c.id,
    c.company,
    c.chequeNo,
    c.payee,
    c.amount,
    c.issueDate,
    c.encodedDate,
    c.bankAccount,
    c.particulars,
    c.status,
    c.createdAt,
    c.imported ? 1 : 0,
    c.companyBasis,
    c.sourceRow,
    c.companyLocked ? 1 : 0,
  );
}

export function removeCheque(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM cheques WHERE id = ?").run(id);
}

/** A company chosen by hand. It is locked, so a sheet sync never changes it. */
export function setCompany(db: DatabaseSync, id: string, company: Company): Cheque {
  const c = getCheque(db, id);
  db.prepare("UPDATE cheques SET company = ?, company_basis = 'manual', company_locked = 1 WHERE id = ?").run(company, id);
  return { ...c, company, companyBasis: "manual", companyLocked: true };
}

export function getCompanyNames(db: DatabaseSync): CompanyNames {
  const row = db.prepare("SELECT value FROM config WHERE key = 'companies'").get() as { value: string } | undefined;
  return { ...DEFAULT_COMPANY_NAMES, ...(row ? (JSON.parse(row.value) as Partial<CompanyNames>) : {}) };
}

export function setCompanyNames(db: DatabaseSync, names: CompanyNames): CompanyNames {
  const clean: CompanyNames = { wwj: names.wwj, wythlae: names.wythlae, wwjcorp: names.wwjcorp };
  db.prepare(
    "INSERT INTO config (key, value) VALUES ('companies', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(clean));
  return clean;
}

export function listHolidays(db: DatabaseSync): Holiday[] {
  return db.prepare("SELECT date, name FROM holidays ORDER BY date").all() as Holiday[];
}

/** Adds the holiday, or renames it when the date is already there. */
export function addHoliday(db: DatabaseSync, h: Holiday): Holiday {
  db.prepare("INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name").run(
    h.date,
    h.name,
  );
  return h;
}

export function removeHoliday(db: DatabaseSync, date: string): void {
  db.prepare("DELETE FROM holidays WHERE date = ?").run(date);
}
