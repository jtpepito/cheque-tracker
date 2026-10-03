import "server-only";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { getCompanyNames, listCheques, setCompanyNames, upsertCheque } from "./cheques";
import { isValidDate, todayManila } from "./dates";
import { parseAmount, peso, sumAmounts } from "./money";
import { COMPANIES, isCompany, isStatus, type Cheque, type CompanyNames } from "./types";

export type ImportFile = { companies?: Partial<CompanyNames>; cheques: Array<Record<string, unknown>> };

const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** Blank stays blank (two source rows have no amount); anything else must be a readable amount. */
function amountOf(raw: unknown, where: string): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  const parsed = typeof raw === "string" ? parseAmount(raw) : null;
  if (parsed === null) throw new Error(`${where}: cannot read amount "${str(raw)}"`);
  return parsed;
}

function toCheque(raw: Record<string, unknown>, index: number): Cheque {
  if (!raw || typeof raw !== "object") throw new Error(`Row ${index + 1}: not a cheque`);
  const id = str(raw.id);
  const where = `Row ${index + 1}${id ? ` (${id})` : ""}`;
  if (!id) throw new Error(`${where}: missing id`);
  if (!isCompany(raw.company)) throw new Error(`${where}: unknown company "${str(raw.company)}"`);
  if (!isStatus(raw.status)) throw new Error(`${where}: unknown status "${str(raw.status)}"`);
  // A few rows in the source sheet have no cheque date. They are kept with an empty date (never
  // in the calendar); a date that is present but malformed is still an error.
  const issueDate = str(raw.issueDate);
  if (issueDate && !isValidDate(issueDate)) throw new Error(`${where}: bad cheque date "${issueDate}"`);
  return {
    id,
    company: raw.company,
    // A spreadsheet exports a numeric cheque no. as "663957.0".
    chequeNo: str(raw.chequeNo).replace(/^(\d+)\.0$/, "$1"),
    payee: str(raw.payee),
    amount: amountOf(raw.amount, where),
    issueDate,
    encodedDate: isValidDate(raw.encodedDate) ? raw.encodedDate : null,
    bankAccount: str(raw.bankAccount),
    particulars: str(raw.particulars),
    status: raw.status,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    imported: raw.imported === true,
    companyBasis: raw.companyBasis == null ? null : str(raw.companyBasis),
    sourceRow: typeof raw.sourceRow === "number" ? raw.sourceRow : null,
    companyLocked: false,
  };
}

/** Count and total of the whole register, then per company, for checking against the source. */
function summarize(db: DatabaseSync): string {
  const all = listCheques(db);
  const part = (label: string, list: Cheque[]) =>
    `${label}${list.length} ${list.length === 1 ? "cheque" : "cheques"}, ${peso(sumAmounts(list.map((c) => c.amount)))}`;
  const per = COMPANIES.map((co) => {
    const list = all.filter((c) => c.company === co);
    return `${co} ${list.length} ${peso(sumAmounts(list.map((c) => c.amount)))}`;
  });
  return [part("[import] ", all), ...per].join(" | ");
}

/** Inserts or replaces every cheque in the file by id. All or nothing. */
export function importCheques(db: DatabaseSync, file: ImportFile): { count: number; summary: string } {
  if (!Array.isArray(file.cheques)) throw new Error('The import file needs a "cheques" list.');
  const cheques = file.cheques.map(toCheque);
  for (const [key, name] of Object.entries(file.companies ?? {})) {
    if (typeof name !== "string" || !name.trim()) throw new Error(`Bad company name for "${key}" in the import file.`);
  }
  db.exec("BEGIN");
  try {
    for (const c of cheques) upsertCheque(db, c);
    if (file.companies) setCompanyNames(db, { ...getCompanyNames(db), ...file.companies });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { count: cheques.length, summary: summarize(db) };
}

/**
 * Loads the file if it exists. It is renamed first, so a file that cannot be renamed is never
 * loaded (and so never loaded again on every restart); if its contents are bad it is put back
 * under its own name to be fixed and retried.
 */
export function importIfPresent(db: DatabaseSync, jsonPath: string): { count: number; summary: string } | null {
  if (!fs.existsSync(jsonPath)) return null;
  const done = jsonPath.replace(/\.json$/, `.imported-${todayManila()}.json`);
  fs.renameSync(jsonPath, done);
  try {
    return importCheques(db, JSON.parse(fs.readFileSync(done, "utf8")) as ImportFile);
  } catch (err) {
    fs.renameSync(done, jsonPath);
    throw err;
  }
}
