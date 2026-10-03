import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canTransition } from "./rules";
import { DEFAULT_COMPANY_NAMES, type Cheque, type Company, type CompanyNames, type Status } from "./types";
import type { NewChequeInput } from "./validate";

export class ChequeError extends Error {
  constructor(
    public code: "not_found" | "conflict" | "duplicate",
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
                          particulars, status, created_at, imported, company_basis, source_row)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       company = excluded.company, cheque_no = excluded.cheque_no, payee = excluded.payee,
       amount = excluded.amount, issue_date = excluded.issue_date, encoded_date = excluded.encoded_date,
       bank_account = excluded.bank_account, particulars = excluded.particulars, status = excluded.status,
       created_at = excluded.created_at, imported = excluded.imported,
       company_basis = excluded.company_basis, source_row = excluded.source_row`,
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
  );
}

export function createCheque(db: DatabaseSync, input: NewChequeInput, now: number = Date.now()): Cheque {
  const clash = db
    .prepare("SELECT 1 FROM cheques WHERE company = ? AND cheque_no = ? COLLATE NOCASE AND status <> 'voided'")
    .get(input.company, input.chequeNo);
  if (clash) {
    throw new ChequeError("duplicate", `Cheque no. ${input.chequeNo} is already in the register for this company.`);
  }
  const c: Cheque = {
    id: randomUUID(),
    ...input,
    encodedDate: null,
    createdAt: now,
    imported: false,
    companyBasis: null,
    sourceRow: null,
  };
  upsertCheque(db, c);
  return c;
}

export function setStatus(db: DatabaseSync, id: string, to: Status): Cheque {
  const c = getCheque(db, id);
  if (!canTransition(c.status, to)) {
    throw new ChequeError(
      "conflict",
      c.status === to ? `This cheque is already ${to}.` : `A ${c.status} cheque can't be marked ${to}.`,
    );
  }
  db.prepare("UPDATE cheques SET status = ? WHERE id = ?").run(to, id);
  return { ...c, status: to };
}

export function setCompany(db: DatabaseSync, id: string, company: Company): Cheque {
  const c = getCheque(db, id);
  db.prepare("UPDATE cheques SET company = ? WHERE id = ?").run(company, id);
  return { ...c, company };
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
