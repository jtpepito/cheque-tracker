import "server-only";
import type { Holiday } from "./banking";
import type { Balance, Trading } from "./projection";
import type { Sql } from "./sql";
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

// Postgres returns numeric and bigint as text; convert here so the rest of the app sees numbers.
function toCheque(r: Row): Cheque {
  return {
    id: r.id as string,
    company: r.company as Company,
    chequeNo: r.cheque_no as string,
    payee: r.payee as string,
    amount: r.amount == null ? null : Number(r.amount),
    issueDate: r.issue_date as string,
    encodedDate: (r.encoded_date as string | null) ?? null,
    bankAccount: r.bank_account as string,
    particulars: r.particulars as string,
    status: r.status as Status,
    createdAt: Number(r.created_at),
    imported: r.imported === true,
    companyBasis: (r.company_basis as string | null) ?? null,
    sourceRow: r.source_row == null ? null : Number(r.source_row),
    companyLocked: r.company_locked === true,
    statusChangedAt: r.status_changed_at == null ? null : Number(r.status_changed_at),
  };
}

export async function listCheques(sql: Sql): Promise<Cheque[]> {
  return (await sql.query<Row>("SELECT * FROM cheques ORDER BY issue_date, cheque_no")).map(toCheque);
}

/**
 * Inserts the cheque, or replaces the row with the same id. A company chosen by hand (locked)
 * is never replaced: the database keeps it even if the caller read the row before the choice
 * was made, which a sheet sync running at the same moment can do.
 */
export async function upsertCheque(sql: Sql, c: Cheque): Promise<void> {
  await sql.query(
    `INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, encoded_date, bank_account,
                          particulars, status, created_at, imported, company_basis, source_row, company_locked,
                          status_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO UPDATE SET
       company = CASE WHEN cheques.company_locked THEN cheques.company ELSE excluded.company END,
       cheque_no = excluded.cheque_no, payee = excluded.payee,
       amount = excluded.amount, issue_date = excluded.issue_date, encoded_date = excluded.encoded_date,
       bank_account = excluded.bank_account, particulars = excluded.particulars, status = excluded.status,
       created_at = excluded.created_at, imported = excluded.imported,
       company_basis = CASE WHEN cheques.company_locked THEN cheques.company_basis ELSE excluded.company_basis END,
       source_row = excluded.source_row,
       company_locked = cheques.company_locked OR excluded.company_locked,
       status_changed_at = excluded.status_changed_at`,
    [
      c.id, c.company, c.chequeNo, c.payee, c.amount, c.issueDate, c.encodedDate, c.bankAccount,
      c.particulars, c.status, c.createdAt, c.imported, c.companyBasis, c.sourceRow, c.companyLocked,
      c.statusChangedAt,
    ],
  );
}

export async function removeCheque(sql: Sql, id: string): Promise<void> {
  await sql.query("DELETE FROM cheques WHERE id = $1", [id]);
}

/** A company chosen by hand. It is locked, so a sheet sync never changes it. */
export async function setCompany(sql: Sql, id: string, company: Company): Promise<Cheque> {
  const rows = await sql.query<Row>(
    "UPDATE cheques SET company = $1, company_basis = 'manual', company_locked = true WHERE id = $2 RETURNING *",
    [company, id],
  );
  if (!rows[0]) throw new ChequeError("not_found", "This cheque no longer exists. Refresh the page.");
  return toCheque(rows[0]);
}

async function getConfig(sql: Sql, key: string): Promise<string | null> {
  return (await sql.query<{ value: string }>("SELECT value FROM config WHERE key = $1", [key]))[0]?.value ?? null;
}

export async function setConfig(sql: Sql, key: string, value: string): Promise<void> {
  await sql.query(
    "INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function getConfigJson<T>(sql: Sql, key: string): Promise<T | null> {
  const value = await getConfig(sql, key);
  return value === null ? null : (JSON.parse(value) as T);
}

export async function deleteConfig(sql: Sql, key: string): Promise<void> {
  await sql.query("DELETE FROM config WHERE key = $1", [key]);
}

export async function getCompanyNames(sql: Sql): Promise<CompanyNames> {
  return { ...DEFAULT_COMPANY_NAMES, ...((await getConfigJson<Partial<CompanyNames>>(sql, "companies")) ?? {}) };
}

export async function setCompanyNames(sql: Sql, names: CompanyNames): Promise<CompanyNames> {
  const clean: CompanyNames = { wwj: names.wwj, wythlae: names.wythlae, wwjcorp: names.wwjcorp };
  await setConfig(sql, "companies", JSON.stringify(clean));
  return clean;
}

export async function listHolidays(sql: Sql): Promise<Holiday[]> {
  return sql.query<Holiday>("SELECT date, name FROM holidays ORDER BY date");
}

/** Adds the holiday, or renames it when the date is already there. */
export async function addHoliday(sql: Sql, h: Holiday): Promise<Holiday> {
  await sql.query("INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET name = excluded.name", [
    h.date,
    h.name,
  ]);
  return h;
}

export async function removeHoliday(sql: Sql, date: string): Promise<void> {
  await sql.query("DELETE FROM holidays WHERE date = $1", [date]);
}

/** Each trading company's bank balance as last typed in, with when. */
export async function listBalances(sql: Sql): Promise<Balance[]> {
  const rows = await sql.query<Row>("SELECT company, amount, updated_at FROM balances ORDER BY company");
  return rows.map((r) => ({ company: r.company as Trading, amount: Number(r.amount), updatedAt: Number(r.updated_at) }));
}

export async function setBalance(sql: Sql, company: Trading, amount: number, now: number = Date.now()): Promise<Balance> {
  await sql.query(
    `INSERT INTO balances (company, amount, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (company) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
    [company, amount, now],
  );
  return { company, amount, updatedAt: now };
}
