import "server-only";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { getCompanyNames, listCheques, setCompanyNames, upsertCheque } from "./cheques";
import { isValidDate, todayManila } from "./dates";
import { peso, sumAmounts } from "./money";
import { COMPANIES, isCompany, isStatus, type Cheque, type CompanyNames } from "./types";

export type ImportFile = { companies?: Partial<CompanyNames>; cheques: Array<Record<string, unknown>> };

const str = (v: unknown) => (v == null ? "" : String(v).trim());

function toCheque(raw: Record<string, unknown>, index: number): Cheque {
  const id = str(raw.id);
  const where = `Row ${index + 1}${id ? ` (${id})` : ""}`;
  if (!id) throw new Error(`${where}: missing id`);
  if (!isCompany(raw.company)) throw new Error(`${where}: unknown company "${str(raw.company)}"`);
  if (!isStatus(raw.status)) throw new Error(`${where}: unknown status "${str(raw.status)}"`);
  if (!isValidDate(raw.issueDate)) throw new Error(`${where}: bad cheque date "${str(raw.issueDate)}"`);
  return {
    id,
    company: raw.company,
    chequeNo: str(raw.chequeNo),
    payee: str(raw.payee),
    amount: typeof raw.amount === "number" && Number.isFinite(raw.amount) ? raw.amount : null,
    issueDate: raw.issueDate,
    encodedDate: isValidDate(raw.encodedDate) ? raw.encodedDate : null,
    bankAccount: str(raw.bankAccount),
    particulars: str(raw.particulars),
    status: raw.status,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    imported: raw.imported === true,
    companyBasis: raw.companyBasis == null ? null : str(raw.companyBasis),
    sourceRow: typeof raw.sourceRow === "number" ? raw.sourceRow : null,
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

/** Loads the file if it exists, then renames it so the next start does not load it again. */
export function importIfPresent(db: DatabaseSync, jsonPath: string): { count: number; summary: string } | null {
  if (!fs.existsSync(jsonPath)) return null;
  const result = importCheques(db, JSON.parse(fs.readFileSync(jsonPath, "utf8")) as ImportFile);
  fs.renameSync(jsonPath, jsonPath.replace(/\.json$/, `.imported-${todayManila()}.json`));
  return result;
}
