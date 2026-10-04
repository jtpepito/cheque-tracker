import "server-only";
import { deleteConfig, getConfigJson, listCheques, removeCheque, setConfig, upsertCheque } from "./cheques";
import { deriveCompany, type SiRefs } from "./company-rules";
import { readRow, type ReadRow, type RowProblem, type SheetRow } from "./sheet-rows";
import type { Sql } from "./sql";
import type { Cheque } from "./types";

// One sync from the Google Sheet: the whole Check Issuances tab, applied in one transaction.
// The sheet wins for everything except a company chosen by hand in the app.

export type SyncPayload = { dryRun: boolean; allowRemovals: boolean; rows: SheetRow[]; siRefs: SiRefs };

export type SyncReport = {
  at: number;
  dryRun: boolean;
  rows: number;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  problems: RowProblem[];
  /** Which known cheques changed and how, so a check can be judged before it is applied. */
  changes: RowChange[];
};

export type RowChange = { row: number; id: string; fields: string[] };

/** A report lists at most this many changed rows; the counts are always complete. */
const MAX_LISTED_CHANGES = 300;

/** What differs between the stored cheque and the sheet's row, in words. */
function changedFields(old: Cheque, next: Cheque, statusText: string): string[] {
  const fields: string[] = [];
  if (old.company !== next.company) fields.push(`company: ${old.company} → ${next.company}`);
  else if (old.companyBasis !== next.companyBasis) fields.push("company basis");
  if (old.chequeNo !== next.chequeNo) fields.push("cheque no.");
  if (old.payee !== next.payee) fields.push("supplier");
  if (old.amount !== next.amount) fields.push("amount");
  if (old.issueDate !== next.issueDate) fields.push("cheque date");
  if (old.encodedDate !== next.encodedDate) fields.push("date logged");
  if (old.particulars !== next.particulars) fields.push("reference");
  if (old.status !== next.status) fields.push(`status: ${old.status} → ${next.status} (sheet says "${statusText}")`);
  return fields;
}

/** A sync the app will not apply. Nothing was changed. */
export class SyncRefused extends Error {
  constructor(
    public status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Thrown inside the transaction to roll a dry run back while keeping its report. */
class DryRunDone extends Error {
  constructor(public report: SyncReport) {
    super("dry run");
  }
}

/** More removals than this in one sync looks like a half-read sheet. */
export const MAX_REMOVALS = 20;

const COMPANY_KEYS = ["wwj", "wythlae", "wwjcorp"] as const;

export function parsePayload(body: unknown): SyncPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.rows)) return null;
  const refs = b.siRefs ?? {};
  if (typeof refs !== "object" || Array.isArray(refs)) return null;
  const siRefs: SiRefs = {};
  for (const key of COMPANY_KEYS) {
    const value = (refs as Record<string, unknown>)[key];
    if (typeof value === "string") siRefs[key] = value;
  }
  return { dryRun: b.dryRun === true, allowRemovals: b.allowRemovals === true, rows: b.rows as SheetRow[], siRefs };
}

/** What the sheet says about a cheque, ignoring where the row sits. */
function sameContent(a: Cheque, b: Cheque): boolean {
  return (
    a.company === b.company &&
    a.companyBasis === b.companyBasis &&
    a.chequeNo === b.chequeNo &&
    a.payee === b.payee &&
    a.amount === b.amount &&
    a.issueDate === b.issueDate &&
    a.encodedDate === b.encodedDate &&
    a.particulars === b.particulars &&
    a.status === b.status
  );
}

export async function applySync(sql: Sql, payload: SyncPayload, now: number = Date.now()): Promise<SyncReport> {
  const problems: RowProblem[] = [];
  const good = new Map<string, ReadRow>();
  payload.rows.forEach((raw, index) => {
    const read = readRow(raw, index);
    if (!read.ok) problems.push(read.problem);
    else if (good.has(read.value.id)) {
      problems.push({ row: read.value.row, id: read.value.id, reason: `Tracker ID ${read.value.id} is used by more than one row.` });
    } else good.set(read.value.id, read.value);
  });
  if (good.size === 0) throw new SyncRefused(400, "The sheet sent no cheque rows that could be read. Nothing was changed.");

  // A known cheque whose row cannot be read keeps its last good values; it is not removed.
  const unreadable = new Set(problems.map((p) => p.id));

  try {
    return await sql.tx(async (t) => {
      // One sync at a time: a second one waits here until the first has finished.
      await t.query("SELECT pg_advisory_xact_lock(7234501)");
      const existing = new Map((await listCheques(t)).map((c) => [c.id, c]));
      const report: SyncReport = {
        at: now,
        dryRun: payload.dryRun,
        rows: payload.rows.length,
        added: 0,
        changed: 0,
        removed: 0,
        unchanged: 0,
        problems,
        changes: [],
      };

      for (const r of good.values()) {
        const old = existing.get(r.id);
        const derived = deriveCompany(r.chequeNo, r.payee, payload.siRefs);
        const next: Cheque = {
          id: r.id,
          company: old?.companyLocked ? old.company : derived.company,
          chequeNo: r.chequeNo,
          payee: r.payee,
          amount: r.amount,
          issueDate: r.issueDate,
          encodedDate: r.encodedDate,
          bankAccount: old?.bankAccount ?? "",
          particulars: r.particulars,
          status: r.status,
          createdAt: old?.createdAt ?? now,
          imported: true,
          companyBasis: old?.companyLocked ? old.companyBasis : derived.basis,
          sourceRow: r.row,
          companyLocked: old?.companyLocked ?? false,
          // A cheque first seen, or seen with a new status, is stamped now.
          statusChangedAt: !old || old.status !== r.status ? now : old.statusChangedAt,
        };
        if (!old) report.added += 1;
        else if (sameContent(old, next)) report.unchanged += 1;
        else {
          report.changed += 1;
          if (report.changes.length < MAX_LISTED_CHANGES) {
            report.changes.push({ row: r.row, id: r.id, fields: changedFields(old, next, r.statusText) });
          }
        }
        if (!old || !sameContent(old, next) || old.sourceRow !== next.sourceRow || !old.imported) await upsertCheque(t, next);
      }

      const gone = [...existing.values()].filter((c) => c.imported && !good.has(c.id) && !unreadable.has(c.id));
      if (gone.length > MAX_REMOVALS && !payload.allowRemovals) {
        throw new SyncRefused(
          409,
          `This sync would remove ${gone.length} cheques, which is more than ${MAX_REMOVALS}. Nothing was changed. ` +
            `If the rows were deleted on purpose, use "Sync now, allowing removals".`,
        );
      }
      for (const c of gone) await removeCheque(t, c.id);
      report.removed = gone.length;

      if (payload.dryRun) throw new DryRunDone(report);
      await setConfig(t, "last_sync", JSON.stringify(report));
      await deleteConfig(t, "last_sync_refusal");
      return report;
    });
  } catch (err) {
    if (err instanceof DryRunDone) {
      // The check itself was rolled back; only its report is kept, to be looked at afterwards.
      await setConfig(sql, "last_check", JSON.stringify(err.report));
      return err.report;
    }
    throw err;
  }
}

export function getLastCheck(sql: Sql): Promise<SyncReport | null> {
  return getConfigJson<SyncReport>(sql, "last_check");
}

export type SyncRefusal = { at: number; message: string };

/** Remembered so the page can say why the sheet's changes are not arriving. Cleared by the next real sync. */
export async function recordRefusal(sql: Sql, message: string, now: number = Date.now()): Promise<void> {
  await setConfig(sql, "last_sync_refusal", JSON.stringify({ at: now, message }));
}

export function getLastRefusal(sql: Sql): Promise<SyncRefusal | null> {
  return getConfigJson<SyncRefusal>(sql, "last_sync_refusal");
}

export function getLastSync(sql: Sql): Promise<SyncReport | null> {
  return getConfigJson<SyncReport>(sql, "last_sync");
}
