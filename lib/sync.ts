import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { listCheques, removeCheque, upsertCheque } from "./cheques";
import { deriveCompany, type SiRefs } from "./company-rules";
import { readRow, type ReadRow, type RowProblem, type SheetRow } from "./sheet-rows";
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
};

/** A sync the app will not apply. Nothing was changed. */
export class SyncRefused extends Error {
  constructor(
    public status: 400 | 409,
    message: string,
  ) {
    super(message);
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

export function applySync(db: DatabaseSync, payload: SyncPayload, now: number = Date.now()): SyncReport {
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

  const existing = new Map(listCheques(db).map((c) => [c.id, c]));
  // A known cheque whose row cannot be read keeps its last good values; it is not removed.
  const unreadable = new Set(problems.map((p) => p.id));
  const report: SyncReport = {
    at: now,
    dryRun: payload.dryRun,
    rows: payload.rows.length,
    added: 0,
    changed: 0,
    removed: 0,
    unchanged: 0,
    problems,
  };

  db.exec("BEGIN");
  try {
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
      };
      if (!old) report.added += 1;
      else if (sameContent(old, next)) report.unchanged += 1;
      else report.changed += 1;
      if (!old || !sameContent(old, next) || old.sourceRow !== next.sourceRow || !old.imported) upsertCheque(db, next);
    }

    const gone = [...existing.values()].filter((c) => c.imported && !good.has(c.id) && !unreadable.has(c.id));
    if (gone.length > MAX_REMOVALS && !payload.allowRemovals) {
      throw new SyncRefused(
        409,
        `This sync would remove ${gone.length} cheques, which is more than ${MAX_REMOVALS}. Nothing was changed. ` +
          `If the rows were deleted on purpose, use "Sync now, allowing removals".`,
      );
    }
    for (const c of gone) removeCheque(db, c.id);
    report.removed = gone.length;

    if (payload.dryRun) db.exec("ROLLBACK");
    else {
      db.prepare(
        "INSERT INTO config (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(JSON.stringify(report));
      db.prepare("DELETE FROM config WHERE key = 'last_sync_refusal'").run();
      db.exec("COMMIT");
    }
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Already rolled back; keep the original error.
    }
    throw err;
  }
  return report;
}

export type SyncRefusal = { at: number; message: string };

/** Remembered so the page can say why the sheet's changes are not arriving. Cleared by the next real sync. */
export function recordRefusal(db: DatabaseSync, message: string, now: number = Date.now()): void {
  db.prepare(
    "INSERT INTO config (key, value) VALUES ('last_sync_refusal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ at: now, message }));
}

export function getLastRefusal(db: DatabaseSync): SyncRefusal | null {
  const row = db.prepare("SELECT value FROM config WHERE key = 'last_sync_refusal'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as SyncRefusal) : null;
}

export function getLastSync(db: DatabaseSync): SyncReport | null {
  const row = db.prepare("SELECT value FROM config WHERE key = 'last_sync'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as SyncReport) : null;
}
