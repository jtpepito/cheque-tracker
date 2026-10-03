# Live Sync from the Google Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The tracker follows the Google Sheet: a script in the sheet posts the Check Issuances tab to the app within about a minute of an edit, and the app updates its cheques from it.

**Architecture:** A thin Google Apps Script reads the tab, fills a "Tracker ID" column and posts JSON to `POST /api/sync`, authenticated by a shared secret. All meaning lives in the app: `lib/sheet-rows.ts` reads a row, `lib/company-rules.ts` assigns a company, `lib/sync.ts` applies a whole sync in one transaction and produces a report. The page loses its status buttons and New cheque form and gains a sync line and a "Sheet rows to fix" box.

**Tech Stack:** As the existing app (Next.js 15.5.27, node:sqlite, Vitest 3), plus Google Apps Script (V8 runtime) for `sheet-script/Code.gs`.

**Spec:** `docs/superpowers/specs/2026-10-03-sheet-sync-design.md`

## Global Constraints

- Project folder: `C:\WWJ\Claude Coding\Cheques`. Use `npm.cmd` / `npx.cmd`.
- Sheet tab names (read from the real sheet on 3 Oct 2026): `Check Issuances`, `WWJ SI`, `Wythlae SI`, `WWJ Corp SI`. Other tabs (`WWJ DR`, `Wythlae DR`, `WWJ CORP DR`, `Expenses`) are not used.
- Check Issuances headers: `Date`, `Name of Supplier`, `Check Number`, `Amount`, `Cheque Date`, `Check Status`, `CR No./ SI No.`. SI tabs have a `Payment Details` header. Headers are matched trimmed and case-insensitively (the real `Date ` header has a trailing space).
- Status mapping (exact words, case and spaces ignored): Cleared, Encashed → `cleared`; Released to Supplier → `issued`; Cancelled, Returned, Replaced → `voided`; With Christine → `pending`; anything else → `issued`.
- Company basis labels, as already stored: `checkno-label`, `supplier-label`, `si-crossref`, `none`; a hand choice stores `manual`.
- Removal guard: more than 20 removals without `allowRemovals` refuses the sync. Stale warning: 90 minutes.
- `SYNC_KEY` must be at least 32 characters. Never commit a real key; `.env.development` holds a dev-only value.
- Real payees and amounts never enter git. Tests use made-up data.
- Never write a log file inside the project while `next dev` runs (the watcher loops).
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **The sheet is sorted, or rows are inserted.** Cheques are matched by Tracker ID, so nothing is mixed up, and a row that only moved does not count as changed. Test in Task 4.
2. **Someone mistypes a date or amount on a known cheque.** The row is listed to fix, the cheque keeps its last good values, and the rest of the sync applies. Test in Task 4.
3. **The sheet arrives blank or half-loaded.** A sync with no readable rows is refused; more than 20 removals is refused unless allowed. Test in Task 4.
4. **A company chosen by hand.** It survives every later sync. Test in Task 4.
5. **The same sync arrives twice.** The second changes nothing and reports everything unchanged. Test in Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `lib/sheet-rows.ts` (new) | Read one sheet row into cheque fields, or say why it can't be read |
| `lib/company-rules.ts` (new) | The three company rules |
| `lib/sync.ts` (new) | Check a sync payload, apply it, report, remember the last report |
| `lib/sync-key.ts` (new) | Check the bearer key |
| `lib/sync-status.ts` (new) | The text of the page's sync line |
| `app/api/sync/route.ts` (new) | The endpoint the script posts to |
| `components/sync-status.tsx` (new) | Sync line and "Sheet rows to fix" |
| `sheet-script/Code.gs` (new) | The Apps Script |
| `lib/cheques.ts`, `lib/db.ts`, `lib/types.ts`, `lib/import.ts` | `company_locked`; create/status functions removed |
| `components/register.tsx`, `components/tracker.tsx`, routes | Status buttons and form removed |
| Deleted | `lib/validate.ts`, `lib/rules.ts`, `components/cheque-form.tsx`, `app/api/cheques/route.ts`, `tests/validate.test.ts`, `tests/rules.test.ts` |

---

### Task 1: Reading a sheet row

**Files:**
- Create: `lib/sheet-rows.ts`
- Test: `tests/sheet-rows.test.ts`

**Interfaces:**
- Consumes: `isValidDate` (`lib/dates.ts`), `parseAmount` (`lib/money.ts`), `Status` (`lib/types.ts`).
- Produces:
  - `type SheetRow = { id?: unknown; row?: unknown; date?: unknown; supplier?: unknown; chequeNo?: unknown; amount?: unknown; chequeDate?: unknown; status?: unknown; reference?: unknown }`
  - `type ReadRow = { id: string; row: number; payee: string; chequeNo: string; amount: number | null; issueDate: string; encodedDate: string | null; particulars: string; status: Status }`
  - `type RowProblem = { row: number; id: string; reason: string }`
  - `parseSheetDate(raw: unknown): string | null`
  - `statusFromSheet(raw: unknown): Status`
  - `readRow(raw: SheetRow, index: number): { ok: true; value: ReadRow } | { ok: false; problem: RowProblem }`

- [ ] **Step 1: Write the failing test**

`tests/sheet-rows.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseSheetDate, readRow, statusFromSheet, type SheetRow } from "@/lib/sheet-rows";

const row = (over: SheetRow = {}): SheetRow => ({
  id: "imp-2",
  row: 2,
  date: "2026-09-28",
  supplier: " Sample Supplier ",
  chequeNo: "590417",
  amount: 16882.63,
  chequeDate: "2026-10-05",
  status: "Released to Supplier",
  reference: " SI 1 ",
  ...over,
});

describe("parseSheetDate", () => {
  it("reads ISO dates and dates typed the sheet's way", () => {
    expect(parseSheetDate("2026-10-05")).toBe("2026-10-05");
    expect(parseSheetDate("12/10/25")).toBe("2025-12-10");
    expect(parseSheetDate("1/5/2026")).toBe("2026-01-05");
    expect(parseSheetDate(" 02/04/2026 ")).toBe("2026-02-04");
  });
  it("returns null for anything that is not a date", () => {
    for (const bad of ["13/45/26", "2026-02-30", "soon", "", null, undefined, 45000]) {
      expect(parseSheetDate(bad)).toBeNull();
    }
  });
});

describe("statusFromSheet", () => {
  it("maps the sheet's words, ignoring case and spaces", () => {
    expect(statusFromSheet("Cleared")).toBe("cleared");
    expect(statusFromSheet(" encashed ")).toBe("cleared");
    expect(statusFromSheet("Released to Supplier")).toBe("issued");
    expect(statusFromSheet("Cancelled")).toBe("voided");
    expect(statusFromSheet("RETURNED")).toBe("voided");
    expect(statusFromSheet("Replaced")).toBe("voided");
    expect(statusFromSheet("With Christine")).toBe("pending");
  });
  it("treats blank or unknown words as issued", () => {
    expect(statusFromSheet("")).toBe("issued");
    expect(statusFromSheet(null)).toBe("issued");
    expect(statusFromSheet("Stale")).toBe("issued");
  });
});

describe("readRow", () => {
  it("reads a complete row and trims text", () => {
    expect(readRow(row(), 0)).toEqual({
      ok: true,
      value: {
        id: "imp-2",
        row: 2,
        payee: "Sample Supplier",
        chequeNo: "590417",
        amount: 16882.63,
        issueDate: "2026-10-05",
        encodedDate: "2026-09-28",
        particulars: "SI 1",
        status: "issued",
      },
    });
  });

  it("reads an amount typed as text and a date typed as text", () => {
    const r = readRow(row({ amount: "₱16,882.63", chequeDate: "12/10/25" }), 0);
    expect(r.ok && r.value.amount).toBe(16882.63);
    expect(r.ok && r.value.issueDate).toBe("2025-12-10");
  });

  it("keeps a blank amount, a blank cheque date, a blank cheque no. and a blank logged date", () => {
    const r = readRow(row({ amount: "", chequeDate: "", chequeNo: "", date: "" }), 0);
    expect(r.ok && r.value).toMatchObject({ amount: null, issueDate: "", chequeNo: "", encodedDate: null });
  });

  it("drops the .0 from a numeric cheque no. and keeps leading zeros", () => {
    expect(readRow(row({ chequeNo: "663957.0" }), 0)).toMatchObject({ value: { chequeNo: "663957" } });
    expect(readRow(row({ chequeNo: "0012" }), 0)).toMatchObject({ value: { chequeNo: "0012" } });
  });

  it("reports a row with no Tracker ID, using its position when the row number is missing", () => {
    expect(readRow(row({ id: "", row: undefined }), 5)).toEqual({
      ok: false,
      problem: { row: 7, id: "", reason: "This row has no Tracker ID." },
    });
  });

  it("reports a cheque date or amount it cannot read", () => {
    expect(readRow(row({ chequeDate: "13/45/26" }), 0)).toEqual({
      ok: false,
      problem: { row: 2, id: "imp-2", reason: 'Cheque date "13/45/26" is not a date.' },
    });
    expect(readRow(row({ amount: "abc" }), 0)).toMatchObject({ ok: false, problem: { reason: 'Amount "abc" is not an amount.' } });
    expect(readRow(row({ amount: -5 }), 0)).toMatchObject({ ok: false, problem: { reason: 'Amount "-5" is not an amount.' } });
  });

  it("reports a row that is not an object", () => {
    expect(readRow(null as unknown as SheetRow, 3)).toEqual({
      ok: false,
      problem: { row: 5, id: "", reason: "This row could not be read." },
    });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/sheet-rows`.

- [ ] **Step 3: Write `lib/sheet-rows.ts`**

```ts
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
  const s = text(raw).toLowerCase();
  if (s === "cleared" || s === "encashed") return "cleared";
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
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm.cmd test`
Expected: PASS, including `tests/sheet-rows.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sync): read a sheet row into cheque fields"
```

---

### Task 2: Company rules

**Files:**
- Create: `lib/company-rules.ts`
- Test: `tests/company-rules.test.ts`

**Interfaces:**
- Consumes: `Company` (`lib/types.ts`).
- Produces:
  - `type SiRefs = Partial<Record<"wwj" | "wythlae" | "wwjcorp", string>>`
  - `deriveCompany(chequeNo: string, supplier: string, siRefs: SiRefs): { company: Company; basis: "checkno-label" | "supplier-label" | "si-crossref" | "none" }`

- [ ] **Step 1: Write the failing test**

`tests/company-rules.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deriveCompany } from "@/lib/company-rules";

const si = {
  wwj: "wwj cbc 653511 164,973.75\nCBC 642758 157,580.36",
  wythlae: "CBC 642848 75,079.61\nMB FT 7325.00",
  wwjcorp: "CBC 667011 29,035.38",
};

describe("deriveCompany", () => {
  it("uses a company name in the cheque no. first", () => {
    expect(deriveCompany("WWJ 653507", "Wythlae Supplier", si)).toEqual({ company: "wwj", basis: "checkno-label" });
    expect(deriveCompany("WWJ682068", "Sample", {})).toEqual({ company: "wwj", basis: "checkno-label" });
    expect(deriveCompany("wythlae 100200", "Sample", {})).toEqual({ company: "wythlae", basis: "checkno-label" });
  });

  it("tests WWJ Corp before WWJ", () => {
    expect(deriveCompany("WWJ Corp 667011", "Sample", {})).toEqual({ company: "wwjcorp", basis: "checkno-label" });
    expect(deriveCompany("123456", "SBC - WWJCORP CBC", {})).toEqual({ company: "wwjcorp", basis: "supplier-label" });
  });

  it("then a company name in the supplier", () => {
    expect(deriveCompany("620965", "SBC - Wythlae 2 CBC", si)).toEqual({ company: "wythlae", basis: "supplier-label" });
  });

  it("then the cheque no. found in exactly one company's SI tab", () => {
    expect(deriveCompany("653511", "Sample Supplier", si)).toEqual({ company: "wwj", basis: "si-crossref" });
    expect(deriveCompany("642848", "Sample Supplier", si)).toEqual({ company: "wythlae", basis: "si-crossref" });
    expect(deriveCompany("667011", "Sample Supplier", si)).toEqual({ company: "wwjcorp", basis: "si-crossref" });
  });

  it("matches the whole number only, never part of a longer number or an amount", () => {
    expect(deriveCompany("65351", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("7325", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("164973", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
  });

  it("does not guess when the number is in two companies' tabs, or nowhere, or blank", () => {
    const both = { wwj: "CBC 700100 1.00", wythlae: "CBC 700100 1.00" };
    expect(deriveCompany("700100", "Sample", both)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("999999", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
  });
});
```

Note on the third case of "matches the whole number only": `164973` appears inside the amount `164,973.75` only with a comma between, so it must not match.

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/company-rules`.

- [ ] **Step 3: Write `lib/company-rules.ts`**

```ts
import type { Company } from "./types";

// Which company wrote a cheque, worked out from the sheet. Nothing is guessed: when the rules
// do not single out one company the cheque stays Unassigned for staff to choose.

type Trading = Exclude<Company, "unassigned">;

/** The "Payment Details" text of each company's SI tab. */
export type SiRefs = Partial<Record<Trading, string>>;

// "WWJ Corp" is tested before "WWJ", which it contains.
const NAMES: Array<[Trading, RegExp]> = [
  ["wwjcorp", /wwj\s*corp/i],
  ["wythlae", /wythlae/i],
  ["wwj", /wwj/i],
];

function named(text: string): Trading | null {
  for (const [company, pattern] of NAMES) if (pattern.test(text)) return company;
  return null;
}

export function deriveCompany(
  chequeNo: string,
  supplier: string,
  siRefs: SiRefs,
): { company: Company; basis: "checkno-label" | "supplier-label" | "si-crossref" | "none" } {
  const inChequeNo = named(chequeNo);
  if (inChequeNo) return { company: inChequeNo, basis: "checkno-label" };
  const inSupplier = named(supplier);
  if (inSupplier) return { company: inSupplier, basis: "supplier-label" };

  const digits = chequeNo.replace(/\D/g, "");
  if (digits.length >= 5) {
    // The whole number, not part of a longer one and not the start of an amount like 164,973.75.
    const whole = new RegExp(`(?<![\\d,.])${digits}(?!\\d|[,.]\\d)`);
    const hits = (["wwj", "wythlae", "wwjcorp"] as const).filter((co) => whole.test(siRefs[co] ?? ""));
    if (hits.length === 1) return { company: hits[0], basis: "si-crossref" };
  }
  return { company: "unassigned", basis: "none" };
}
```

- [ ] **Step 4: Run tests**

Run: `npm.cmd test`
Expected: PASS, including `tests/company-rules.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sync): company rules from cheque no., supplier and SI tabs"
```

---

### Task 3: Company lock; remove creating cheques and changing status in the app

**Files:**
- Modify: `lib/types.ts`, `lib/db.ts`, `lib/import.ts`, `tests/helpers.ts`, `tests/import.test.ts`
- Replace: `lib/cheques.ts`, `tests/cheques.test.ts`, `app/api/cheques/[id]/route.ts`
- Delete: `lib/validate.ts`, `lib/rules.ts`, `tests/validate.test.ts`, `tests/rules.test.ts`, `app/api/cheques/route.ts`, `components/cheque-form.tsx`
- Modify (to keep the build green until Task 6): `components/register.tsx`, `components/tracker.tsx`

**Interfaces:**
- Produces:
  - `Cheque.companyLocked: boolean`
  - `lib/cheques.ts`: `ChequeError` (code `"not_found"`), `listCheques`, `upsertCheque` (now also writes `companyLocked`), `removeCheque(db, id): void`, `setCompany(db, id, company): Cheque` (sets `companyLocked: true`, `companyBasis: "manual"`), `getCompanyNames`, `setCompanyNames`, `listHolidays`, `addHoliday`, `removeHoliday`
  - Removed: `createCheque`, `setStatus`, `validateNewCheque`, `canTransition`, `nextStatuses`
  - `PATCH /api/cheques/:id` accepts only `{ company }`

- [ ] **Step 1: Rewrite the store test (fails first)**

`tests/cheques.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ChequeError,
  getCompanyNames,
  listCheques,
  removeCheque,
  setCompany,
  setCompanyNames,
  upsertCheque,
} from "@/lib/cheques";
import { openDatabase } from "@/lib/db";
import { cheque } from "./helpers";

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("cheques store", () => {
  it("saves and lists a cheque with every field", () => {
    const c = cheque({ chequeNo: "0012", encodedDate: "2026-09-28", companyBasis: "none", sourceRow: 7, imported: true });
    upsertCheque(db, c);
    expect(listCheques(db)).toEqual([c]);
  });

  it("replaces the cheque with the same id", () => {
    const c = cheque({ amount: 10 });
    upsertCheque(db, c);
    upsertCheque(db, { ...c, amount: 20, status: "cleared" });
    expect(listCheques(db)).toEqual([{ ...c, amount: 20, status: "cleared" }]);
  });

  it("locks the company when it is chosen by hand", () => {
    const c = cheque({ company: "unassigned", companyBasis: "none" });
    upsertCheque(db, c);
    expect(setCompany(db, c.id, "wwjcorp")).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
    expect(listCheques(db)[0]).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
  });

  it("reports an unknown id", () => {
    try {
      setCompany(db, "nope", "wwj");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChequeError);
      expect((e as ChequeError).code).toBe("not_found");
    }
  });

  it("removes a cheque", () => {
    const c = cheque();
    upsertCheque(db, c);
    removeCheque(db, c.id);
    expect(listCheques(db)).toEqual([]);
  });

  it("starts with the default company names and saves new ones", () => {
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
    setCompanyNames(db, { wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
  });

  it("adds the lock column to a database made before it existed, keeping its cheques", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cheques-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE cheques (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, cheque_no TEXT NOT NULL, payee TEXT NOT NULL, amount REAL,
      issue_date TEXT NOT NULL, encoded_date TEXT, bank_account TEXT NOT NULL DEFAULT '',
      particulars TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at INTEGER NOT NULL,
      imported INTEGER NOT NULL DEFAULT 0, company_basis TEXT, source_row INTEGER)`);
    old.exec(`INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, status, created_at)
              VALUES ('imp-2', 'wwj', '1', 'Sample Supplier', 5, '2026-10-05', 'issued', 0)`);
    old.close();
    const reopened = openDatabase(file);
    expect(listCheques(reopened)).toMatchObject([{ id: "imp-2", companyLocked: false }]);
    reopened.close();
  });
});
```

- [ ] **Step 2: Update the shared test helper and the import test**

In `tests/helpers.ts`, add `companyLocked: false,` after `sourceRow: null,`.

In `tests/import.test.ts`:
- Change the import line `import { createCheque, getCompanyNames, listCheques, setCompany } from "@/lib/cheques";` to `import { getCompanyNames, listCheques, setCompany, upsertCheque } from "@/lib/cheques";` and add `import { cheque } from "./helpers";`.
- In "loads rows with every field", change `expect(listCheques(db)[0]).toEqual(row());` to `expect(listCheques(db)[0]).toEqual({ ...row(), companyLocked: false });`.
- In "leaves cheques that are not in the file alone", replace the whole `createCheque(db, { … });` call with `upsertCheque(db, cheque({ id: "other-1" }));`.

- [ ] **Step 3: Run to see them fail**

Run: `npm.cmd test`
Expected: FAIL — `removeCheque` is not exported, `companyLocked` is missing from listed cheques.

- [ ] **Step 4: Change the types, database and import**

In `lib/types.ts`, add to `Cheque` after `sourceRow`:
```ts
  /** True once someone chose the company by hand; a sheet sync then never changes it. */
  companyLocked: boolean;
```

In `lib/db.ts`, add the column to the `CREATE TABLE cheques` statement after `source_row    INTEGER`:
```sql
  source_row    INTEGER,
  company_locked INTEGER NOT NULL DEFAULT 0
```
and directly after `db.exec(SCHEMA);` add:
```ts
  // Databases made before the lock column existed.
  const columns = db.prepare("PRAGMA table_info(cheques)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "company_locked")) {
    db.exec("ALTER TABLE cheques ADD COLUMN company_locked INTEGER NOT NULL DEFAULT 0");
  }
```

In `lib/import.ts`, in the object `toCheque` returns, add `companyLocked: false,` after the `sourceRow` line.

- [ ] **Step 5: Replace `lib/cheques.ts`**

`lib/cheques.ts`:
```ts
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
```

- [ ] **Step 6: Remove what the app no longer does**

Delete: `lib/validate.ts`, `lib/rules.ts`, `tests/validate.test.ts`, `tests/rules.test.ts`, `app/api/cheques/route.ts`, `components/cheque-form.tsx`.

`app/api/cheques/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { setCompany } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { isCompany } from "@/lib/types";

// Status comes only from the sheet; the page can change a cheque's company and nothing else.
export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    if (!isCompany(body.company)) return badRequest("Unknown company.");
    return NextResponse.json(setCompany(getDb(), id, body.company));
  });
}
```

In `lib/http.ts`, the line `return NextResponse.json({ error: err.message }, { status: err.code === "not_found" ? 404 : 409 });` becomes `return NextResponse.json({ error: err.message }, { status: 404 });`.

In `components/tracker.tsx`, remove the `import { ChequeForm } from "./cheque-form";` line and the `<ChequeForm … />` line.

In `components/register.tsx`: remove the `import { nextStatuses } from "@/lib/rules";` line, the `ACTION_LABEL` constant, and the whole `<div className="flex flex-wrap gap-1.5">…</div>` block that renders the status buttons; change the type of `change`'s `body` parameter to `{ company: Company }`; remove `Status` from the type import if it is now unused except in the filter (it is still used by `Filters`, which is imported separately, so remove it only if TypeScript reports it unused). Task 6 replaces this file in full; this step only keeps the build green.

- [ ] **Step 7: Run tests, typecheck and build**

Run: `npm.cmd test`
Expected: PASS (the validate and rules test files are gone).
Run: `npm.cmd run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sync): lock hand-chosen companies; status and new cheques now come only from the sheet"
```

---

### Task 4: Applying a sync

**Files:**
- Create: `lib/sync.ts`
- Test: `tests/sync.test.ts`

**Interfaces:**
- Consumes: `readRow`, `SheetRow`, `RowProblem` (Task 1); `deriveCompany`, `SiRefs` (Task 2); `listCheques`, `upsertCheque`, `removeCheque`, `setCompany` (Task 3).
- Produces:
  - `type SyncPayload = { dryRun: boolean; allowRemovals: boolean; rows: SheetRow[]; siRefs: SiRefs }`
  - `type SyncReport = { at: number; dryRun: boolean; rows: number; added: number; changed: number; removed: number; unchanged: number; problems: RowProblem[] }`
  - `class SyncRefused extends Error { status: 400 | 409 }`
  - `MAX_REMOVALS = 20`
  - `parsePayload(body: unknown): SyncPayload | null`
  - `applySync(db, payload: SyncPayload, now?: number): SyncReport`
  - `getLastSync(db): SyncReport | null`

- [ ] **Step 1: Write the failing test**

`tests/sync.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { listCheques, setCompany, upsertCheque } from "@/lib/cheques";
import { openDatabase } from "@/lib/db";
import type { SheetRow } from "@/lib/sheet-rows";
import { applySync, getLastSync, parsePayload, SyncRefused, type SyncPayload } from "@/lib/sync";
import { cheque } from "./helpers";

const sheetRow = (n: number, over: SheetRow = {}): SheetRow => ({
  id: `imp-${n}`,
  row: n,
  date: "2026-09-28",
  supplier: "Sample Supplier",
  chequeNo: String(590000 + n),
  amount: 100,
  chequeDate: "2026-10-05",
  status: "Released to Supplier",
  reference: "",
  ...over,
});

const payload = (rows: SheetRow[], over: Partial<SyncPayload> = {}): SyncPayload => ({
  dryRun: false,
  allowRemovals: false,
  rows,
  siRefs: {},
  ...over,
});

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

const byId = (id: string) => listCheques(db).find((c) => c.id === id);

describe("applySync", () => {
  it("adds new cheques from the sheet", () => {
    const report = applySync(db, payload([sheetRow(2), sheetRow(3)]), 1000);
    expect(report).toEqual({ at: 1000, dryRun: false, rows: 2, added: 2, changed: 0, removed: 0, unchanged: 0, problems: [] });
    expect(byId("imp-2")).toMatchObject({
      payee: "Sample Supplier", chequeNo: "590002", amount: 100, issueDate: "2026-10-05", encodedDate: "2026-09-28",
      status: "issued", company: "unassigned", companyBasis: "none", imported: true, sourceRow: 2, createdAt: 1000,
    });
  });

  it("changes nothing when the same sync arrives twice", () => {
    const rows = [sheetRow(2), sheetRow(3)];
    applySync(db, payload(rows), 1000);
    const before = listCheques(db);
    const report = applySync(db, payload(rows), 2000);
    expect(report).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: 2 });
    expect(listCheques(db)).toEqual(before);
  });

  it("lets the sheet win, moving status in either direction", () => {
    applySync(db, payload([sheetRow(2, { status: "Cleared" })]));
    const report = applySync(db, payload([sheetRow(2, { status: "Returned", amount: 250, supplier: "Renamed Supplier" })]));
    expect(report).toMatchObject({ changed: 1, unchanged: 0 });
    expect(byId("imp-2")).toMatchObject({ status: "voided", amount: 250, payee: "Renamed Supplier" });
  });

  it("matches by Tracker ID when the sheet is sorted, and a moved row is not a change", () => {
    applySync(db, payload([sheetRow(2), sheetRow(3)]));
    const sorted = [sheetRow(3, { row: 2 }), sheetRow(2, { row: 3 })];
    const report = applySync(db, payload(sorted));
    expect(report).toMatchObject({ changed: 0, unchanged: 2 });
    expect(byId("imp-2")).toMatchObject({ chequeNo: "590002", sourceRow: 3 });
    expect(byId("imp-3")).toMatchObject({ chequeNo: "590003", sourceRow: 2 });
  });

  it("works out the company from the sheet on every sync", () => {
    applySync(db, payload([sheetRow(2)]));
    expect(byId("imp-2")!.company).toBe("unassigned");
    applySync(db, payload([sheetRow(2)], { siRefs: { wythlae: "CBC 590002 100.00" } }));
    expect(byId("imp-2")).toMatchObject({ company: "wythlae", companyBasis: "si-crossref" });
  });

  it("never changes a company chosen by hand", () => {
    applySync(db, payload([sheetRow(2)]));
    setCompany(db, "imp-2", "wwjcorp");
    const report = applySync(db, payload([sheetRow(2, { status: "Cleared" })], { siRefs: { wythlae: "CBC 590002 100.00" } }));
    expect(report).toMatchObject({ changed: 1 });
    expect(byId("imp-2")).toMatchObject({ company: "wwjcorp", companyBasis: "manual", companyLocked: true, status: "cleared" });
  });

  it("removes cheques that are no longer in the sheet, but not ones entered in the app", () => {
    upsertCheque(db, cheque({ id: "typed-here", imported: false }));
    applySync(db, payload([sheetRow(2), sheetRow(3)]));
    const report = applySync(db, payload([sheetRow(2)]));
    expect(report).toMatchObject({ removed: 1, unchanged: 1 });
    expect(listCheques(db).map((c) => c.id).sort()).toEqual(["imp-2", "typed-here"]);
  });

  it("refuses to remove more than 20 cheques unless told to, and changes nothing", () => {
    const many = Array.from({ length: 23 }, (_, i) => sheetRow(i + 2));
    applySync(db, payload(many));
    try {
      applySync(db, payload([sheetRow(2), sheetRow(3, { status: "Cleared" })]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyncRefused);
      expect((e as SyncRefused).status).toBe(409);
      expect((e as Error).message).toContain("21 cheques");
    }
    expect(listCheques(db)).toHaveLength(23);
    expect(byId("imp-3")!.status).toBe("issued");

    const report = applySync(db, payload([sheetRow(2)], { allowRemovals: true }));
    expect(report.removed).toBe(22);
    expect(listCheques(db)).toHaveLength(1);
  });

  it("skips a row it cannot read, applies the rest, and keeps the known cheque as it was", () => {
    applySync(db, payload([sheetRow(2), sheetRow(3)]));
    const report = applySync(db, payload([sheetRow(2, { chequeDate: "13/45/26", status: "Cleared" }), sheetRow(3, { status: "Cleared" })]));
    expect(report).toMatchObject({ rows: 2, changed: 1, removed: 0, unchanged: 0 });
    expect(report.problems).toEqual([{ row: 2, id: "imp-2", reason: 'Cheque date "13/45/26" is not a date.' }]);
    expect(byId("imp-2")).toMatchObject({ status: "issued", issueDate: "2026-10-05" });
    expect(byId("imp-3")!.status).toBe("cleared");
  });

  it("uses the first row when a Tracker ID is repeated and reports the others", () => {
    const report = applySync(db, payload([sheetRow(2), sheetRow(2, { row: 9, amount: 999 })]));
    expect(report.added).toBe(1);
    expect(report.problems).toEqual([{ row: 9, id: "imp-2", reason: "Tracker ID imp-2 is used by more than one row." }]);
    expect(byId("imp-2")!.amount).toBe(100);
  });

  it("refuses a sync with no readable cheque rows, even with removals allowed", () => {
    applySync(db, payload([sheetRow(2)]));
    for (const rows of [[], [sheetRow(2, { id: "" })]]) {
      try {
        applySync(db, payload(rows, { allowRemovals: true }));
        expect.unreachable();
      } catch (e) {
        expect((e as SyncRefused).status).toBe(400);
      }
    }
    expect(listCheques(db)).toHaveLength(1);
  });

  it("changes nothing on a dry run but reports what would happen", () => {
    applySync(db, payload([sheetRow(2)]), 1000);
    const report = applySync(db, payload([sheetRow(2, { status: "Cleared" }), sheetRow(3)], { dryRun: true }), 2000);
    expect(report).toMatchObject({ dryRun: true, added: 1, changed: 1 });
    expect(listCheques(db)).toHaveLength(1);
    expect(byId("imp-2")!.status).toBe("issued");
    expect(getLastSync(db)!.at).toBe(1000);
  });

  it("remembers the last real sync", () => {
    expect(getLastSync(db)).toBeNull();
    const report = applySync(db, payload([sheetRow(2), sheetRow(3, { amount: "abc" })]), 5000);
    expect(getLastSync(db)).toEqual(report);
  });
});

describe("parsePayload", () => {
  it("accepts the script's shape and fills the optional parts", () => {
    expect(parsePayload({ rows: [{ id: "a" }] })).toEqual({ dryRun: false, allowRemovals: false, rows: [{ id: "a" }], siRefs: {} });
    expect(parsePayload({ rows: [], dryRun: true, allowRemovals: true, siRefs: { wwj: "x", other: "y", wythlae: 5 } })).toEqual({
      dryRun: true, allowRemovals: true, rows: [], siRefs: { wwj: "x" },
    });
  });
  it("rejects anything else", () => {
    for (const bad of [null, [], "x", {}, { rows: "x" }, { rows: [], siRefs: [] }]) expect(parsePayload(bad)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/sync`.

- [ ] **Step 3: Write `lib/sync.ts`**

```ts
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
      db.exec("COMMIT");
    }
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return report;
}

export function getLastSync(db: DatabaseSync): SyncReport | null {
  const row = db.prepare("SELECT value FROM config WHERE key = 'last_sync'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as SyncReport) : null;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm.cmd test`
Expected: PASS, including `tests/sync.test.ts`.
Run: `npm.cmd run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sync): apply a sheet sync in one transaction with a report"
```

---

### Task 5: The sync endpoint

**Files:**
- Create: `lib/sync-key.ts`, `app/api/sync/route.ts`
- Replace: `middleware.ts`, `app/api/state/route.ts`
- Modify: `.env.development`, `.env.example`
- Test: `tests/sync-key.test.ts`

**Interfaces:**
- Consumes: `applySync`, `parsePayload`, `getLastSync`, `SyncRefused` (Task 4); `safeEqual` (`lib/session.ts`).
- Produces:
  - `checkSyncKey(authorization: string | null, key?: string | undefined): "ok" | "unset" | "wrong"`
  - `POST /api/sync` → `200 SyncReport` | `400/409 { error }` | `401 { error }` | `503 { error }`
  - `GET /api/state` adds `now: number` (server time, epoch ms) and `sync: SyncReport | null`

- [ ] **Step 1: Write the failing test**

`tests/sync-key.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkSyncKey } from "@/lib/sync-key";

const KEY = "k".repeat(32);

describe("checkSyncKey", () => {
  it("accepts the right bearer key", () => {
    expect(checkSyncKey(`Bearer ${KEY}`, KEY)).toBe("ok");
  });
  it("rejects a wrong, malformed or missing key", () => {
    expect(checkSyncKey(`Bearer ${"x".repeat(32)}`, KEY)).toBe("wrong");
    expect(checkSyncKey(KEY, KEY)).toBe("wrong");
    expect(checkSyncKey("Bearer ", KEY)).toBe("wrong");
    expect(checkSyncKey(null, KEY)).toBe("wrong");
  });
  it("treats an unset or short server key as sync not set up, whatever is sent", () => {
    expect(checkSyncKey(`Bearer ${KEY}`, undefined)).toBe("unset");
    expect(checkSyncKey("Bearer short", "short")).toBe("unset");
    expect(checkSyncKey("Bearer ", "")).toBe("unset");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/sync-key`.

- [ ] **Step 3: Write the key check, route, middleware and state route**

`lib/sync-key.ts`:
```ts
import { safeEqual } from "./session";

/** The sheet's script proves itself with "Authorization: Bearer <SYNC_KEY>". */
export function checkSyncKey(
  authorization: string | null,
  key: string | undefined = process.env.SYNC_KEY,
): "ok" | "unset" | "wrong" {
  if (!key || key.length < 32) return "unset";
  const sent = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return sent && safeEqual(sent, key) ? "ok" : "wrong";
}
```

`app/api/sync/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { applySync, parsePayload, SyncRefused } from "@/lib/sync";
import { checkSyncKey } from "@/lib/sync-key";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

// Called by the script in the Google Sheet, not by the page: it carries a key, not a session.
export async function POST(req: Request) {
  const key = checkSyncKey(req.headers.get("authorization"));
  if (key === "unset") return refuse(503, "Sync is not set up.");
  if (key === "wrong") return refuse(401, "Wrong sync key.");

  const text = await req.text();
  if (text.length > MAX_BYTES) return refuse(400, "The sync is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "The sync was not understood.");
  }
  const payload = parsePayload(body);
  if (!payload) return refuse(400, "The sync was not understood.");

  try {
    return NextResponse.json(applySync(getDb(), payload));
  } catch (err) {
    if (err instanceof SyncRefused) return refuse(err.status, err.message);
    console.error("[sync] failed:", err);
    return refuse(500, "The sync failed. Nothing was changed.");
  }
}
```

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Every page and API route needs a valid session except /login and /api/sync (the sheet's
// script, which proves itself with the sync key instead; see app/api/sync).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/sync") return NextResponse.next();

  const authed = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    return authed ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
    return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`app/api/state/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getCompanyNames, listCheques, listHolidays } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/http";
import { getLastSync } from "@/lib/sync";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(() => {
    const db = getDb();
    return NextResponse.json(
      {
        today: todayManila(),
        now: Date.now(),
        companies: getCompanyNames(db),
        holidays: listHolidays(db),
        sync: getLastSync(db),
        cheques: listCheques(db),
      },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
```

Add to `.env.development`:
```
# Dev-only sync key so the sheet sync can be tried locally. Never use this value in production.
SYNC_KEY=dev-only-sync-key-not-for-production-0000
```

Add to `.env.example`:
```
# Secret the Google Sheet's script sends with each sync (at least 32 characters).
SYNC_KEY=
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm.cmd test`
Expected: PASS, including `tests/sync-key.test.ts`.
Run: `npm.cmd run typecheck`
Expected: no errors.

- [ ] **Step 5: Try the endpoint locally**

Restart the dev server (its log must go outside the project folder), then in Git Bash:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3002/api/sync -d '{}'
curl -s -w " %{http_code}\n" -X POST http://localhost:3002/api/sync -H "Authorization: Bearer dev-only-sync-key-not-for-production-0000" -d 'nope'
curl -s -w " %{http_code}\n" -X POST http://localhost:3002/api/sync -H "Authorization: Bearer dev-only-sync-key-not-for-production-0000" -H "content-type: application/json" -d '{"rows":[]}'
```
Expected: `401`; `{"error":"The sync was not understood."} 400`; `{"error":"The sheet sent no cheque rows that could be read. Nothing was changed."} 400`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sync): POST /api/sync with a bearer key; state returns the last sync"
```

---

### Task 6: The page follows the sheet

**Files:**
- Create: `lib/sync-status.ts`, `components/sync-status.tsx`
- Replace: `components/register.tsx`, `components/tracker.tsx`
- Test: `tests/sync-status.test.ts`

**Interfaces:**
- Consumes: `SyncReport` (Task 4); `/api/state` with `now` and `sync` (Task 5); `Cheque.companyLocked` (Task 3).
- Produces: `syncLine(sync: SyncReport | null, now: number): { text: string; warn: boolean }`, `STALE_MS`.

- [ ] **Step 1: Write the failing test**

`tests/sync-status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { syncLine } from "@/lib/sync-status";
import type { SyncReport } from "@/lib/sync";

// 3 Oct 2026, 2:15 PM in Manila.
const AT = Date.UTC(2026, 9, 3, 6, 15);
const MIN = 60_000;
const report = (over: Partial<SyncReport> = {}): SyncReport => ({
  at: AT, dryRun: false, rows: 587, added: 0, changed: 0, removed: 0, unchanged: 587, problems: [], ...over,
});

describe("syncLine", () => {
  it("says so before the first sync", () => {
    expect(syncLine(null, AT)).toEqual({ text: "Not yet connected to the sheet.", warn: false });
  });
  it("says how long ago the sheet synced and how many cheques it holds", () => {
    expect(syncLine(report(), AT + 20_000)).toEqual({ text: "Synced from the sheet just now · 587 cheques", warn: false });
    expect(syncLine(report(), AT + MIN)).toEqual({ text: "Synced from the sheet 1 minute ago · 587 cheques", warn: false });
    expect(syncLine(report(), AT + 59 * MIN).text).toBe("Synced from the sheet 59 minutes ago · 587 cheques");
    expect(syncLine(report(), AT + 90 * MIN).text).toBe("Synced from the sheet 1 hour ago · 587 cheques");
  });
  it("does not count rows that need fixing as cheques", () => {
    const problems = [{ row: 9, id: "x", reason: "bad" }];
    expect(syncLine(report({ rows: 1, problems }), AT).text).toBe("Synced from the sheet just now · 0 cheques");
    expect(syncLine(report({ rows: 2, problems }), AT).text).toBe("Synced from the sheet just now · 1 cheque");
  });
  it("warns, with the Manila time, when nothing has arrived for more than 90 minutes", () => {
    expect(syncLine(report(), AT + 91 * MIN)).toEqual({
      text: "No update from the sheet since 3 Oct, 2:15 PM. The calendar may be out of date.",
      warn: true,
    });
  });
  it("copes with a clock that is slightly behind the server", () => {
    expect(syncLine(report(), AT - 5000).text).toBe("Synced from the sheet just now · 587 cheques");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/sync-status`.

- [ ] **Step 3: Write `lib/sync-status.ts`**

```ts
import type { SyncReport } from "./sync";

/** After this long without a sync the page warns that it may be out of date. */
export const STALE_MS = 90 * 60 * 1000;

/** "3 Oct, 2:15 PM" in Manila. Built from parts so the spacing does not vary between systems. */
function manilaTime(at: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

export function syncLine(sync: SyncReport | null, now: number): { text: string; warn: boolean } {
  if (!sync) return { text: "Not yet connected to the sheet.", warn: false };
  const age = Math.max(0, now - sync.at);
  if (age > STALE_MS) {
    return { text: `No update from the sheet since ${manilaTime(sync.at)}. The calendar may be out of date.`, warn: true };
  }
  const cheques = sync.rows - sync.problems.length;
  return { text: `Synced from the sheet ${ago(age)} · ${cheques} ${cheques === 1 ? "cheque" : "cheques"}`, warn: false };
}
```

- [ ] **Step 4: Run the test**

Run: `npm.cmd test`
Expected: PASS, including `tests/sync-status.test.ts`.

- [ ] **Step 5: Write the components**

`components/sync-status.tsx`:
```tsx
import type { SyncReport } from "@/lib/sync";
import { syncLine } from "@/lib/sync-status";

/** When the sheet last synced, and any sheet rows the app could not read. */
export function SyncStatus({ sync, now }: { sync: SyncReport | null; now: number }) {
  const line = syncLine(sync, now);
  const problems = sync?.problems ?? [];
  return (
    <div className="space-y-2 text-sm">
      <p
        role="status"
        className={line.warn ? "rounded-lg bg-warn p-3 font-medium text-warn-ink" : "text-muted"}
      >
        {line.text}
      </p>
      {problems.length > 0 && (
        <div className="rounded-lg border border-danger p-3">
          <p className="font-semibold text-danger">
            Sheet rows to fix ({problems.length}). These were skipped until they are corrected in the sheet:
          </p>
          <ul className="mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={`${p.row}-${p.id}`}>
                Row {p.row}: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`components/register.tsx`:
```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { clearingDate, type Holiday } from "@/lib/banking";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { DEFAULT_FILTERS, filterAndSort, issuedSummary, unassignedSummary, type Filters } from "@/lib/register";
import { COMPANIES, STATUSES, companyLabel, type Cheque, type Company, type CompanyNames } from "@/lib/types";

const GRID = "md:grid md:grid-cols-[7rem_11rem_8rem_minmax(0,1fr)_8rem_5rem] md:items-center md:gap-3";

export function Register({
  cheques,
  names,
  holidays,
  onChanged,
}: {
  cheques: Cheque[];
  names: CompanyNames;
  holidays: Holiday[];
  onChanged: () => Promise<void>;
}) {
  const holidayDates = new Set(holidays.map((h) => h.date));
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = filterAndSort(cheques, filters);
  const issued = issuedSummary(cheques);
  const unassigned = unassignedSummary(cheques);

  async function setCompany(c: Cheque, company: Company) {
    setBusy(c.id);
    setRowError(null);
    try {
      await api<Cheque>(`/api/cheques/${encodeURIComponent(c.id)}`, "PATCH", { company });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setRowError(`Cheque ${c.chequeNo || "(no number)"}, ${c.payee}: ${message}`);
    }
    await onChanged();
    setBusy(null);
  }

  return (
    <section aria-labelledby="register-heading" className="space-y-3">
      <h2 id="register-heading" className="text-lg font-semibold">
        Register
      </h2>
      <p className="text-sm">
        Issued, not yet cleared: <strong>{peso(issued.total)}</strong> across {issued.count}{" "}
        {issued.count === 1 ? "cheque" : "cheques"}.
      </p>
      <p className="text-sm text-muted">
        Cheques and their status come from the Google Sheet. To add a cheque or mark one cleared, update the sheet.
      </p>
      {unassigned.count > 0 && (
        <p className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          {unassigned.count} outstanding {unassigned.count === 1 ? "cheque has" : "cheques have"} no company (
          {peso(unassigned.total)}). Choose a company for each from its dropdown.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-muted">Company</span>
          <select
            className="field"
            value={filters.company}
            onChange={(e) => setFilters({ ...filters, company: e.target.value as Filters["company"] })}
          >
            <option value="all">All companies</option>
            {COMPANIES.map((co) => (
              <option key={co} value={co}>
                {companyLabel(names, co)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-muted">Status</span>
          <select
            className="field"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2">
          <input
            type="checkbox"
            checked={filters.hideSettled}
            onChange={(e) => setFilters({ ...filters, hideSettled: e.target.checked })}
          />
          Hide cleared &amp; voided
        </label>
        <span className="ml-auto text-muted">
          {rows.length} {rows.length === 1 ? "cheque" : "cheques"} shown
        </span>
      </div>

      {/* Shown above the list, not in the row: the row may be hidden by the filters. */}
      {rowError && (
        <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">
          {rowError}
        </p>
      )}

      <div className={`hidden px-3 text-xs font-medium text-muted ${GRID}`}>
        <span>Cheque date</span>
        <span>Company</span>
        <span>Cheque no.</span>
        <span>Payee</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">No cheques match these filters.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c) => (
            <li
              key={c.id}
              className={`space-y-2 rounded-lg border p-3 text-sm md:space-y-0 ${GRID} ${
                c.company === "unassigned" ? "border-warn-ink/40 bg-warn" : "border-line bg-card"
              }`}
            >
              <div>
                <p className="font-medium">{c.issueDate ? shortDate(c.issueDate) : "No date"}</p>
                {c.issueDate && <p className="text-xs text-muted">{c.issueDate.slice(0, 4)}</p>}
                {(c.status === "issued" || c.status === "pending") &&
                  clearingDate(c.issueDate, holidayDates) !== c.issueDate && (
                    <p className="text-xs font-medium">Clears {shortDate(clearingDate(c.issueDate, holidayDates))}</p>
                  )}
                {c.encodedDate && c.encodedDate !== c.issueDate && (
                  <p className="text-xs text-muted">Logged {shortDate(c.encodedDate)}</p>
                )}
              </div>
              <div>
                <select
                  aria-label={`Company for cheque ${c.chequeNo}`}
                  className="field"
                  value={c.company}
                  disabled={busy === c.id}
                  onChange={(e) => setCompany(c, e.target.value as Company)}
                >
                  {COMPANIES.map((co) => (
                    <option key={co} value={co}>
                      {companyLabel(names, co)}
                    </option>
                  ))}
                </select>
                {c.companyLocked && <p className="mt-0.5 text-xs text-muted">Set here</p>}
              </div>
              <p className="font-mono break-all">{c.chequeNo}</p>
              <div className="min-w-0">
                <p className="break-words font-medium">{c.payee}</p>
                {(c.particulars || c.bankAccount) && (
                  <p className="break-words text-xs text-muted">
                    {[c.particulars, c.bankAccount].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <p className="font-mono md:text-right">{c.amount === null ? "—" : peso(c.amount)}</p>
              <p className="capitalize">{c.status}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`components/tracker.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Holiday } from "@/lib/banking";
import { buildCalendar } from "@/lib/calendar";
import { latestOnly } from "@/lib/latest";
import type { SyncReport } from "@/lib/sync";
import type { Cheque, CompanyNames } from "@/lib/types";
import { FundingCalendar } from "./funding-calendar";
import { Header } from "./header";
import { Holidays } from "./holidays";
import { Register } from "./register";
import { SyncStatus } from "./sync-status";

type State = {
  today: string;
  now: number;
  companies: CompanyNames;
  holidays: Holiday[];
  sync: SyncReport | null;
  cheques: Cheque[];
};

const REFRESH_MS = 30_000;

export function Tracker() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A 30-second poll that lands after a newer refresh must not put older data back.
  const track = useRef(latestOnly()).current;

  const refresh = useCallback(async () => {
    try {
      const res = await track(api<State>("/api/state"));
      if (!res.fresh) return;
      setState(res.value);
      setProblem(null);
    } catch (err) {
      // Keep showing the last data; the next cycle tries again.
      setProblem(err instanceof ApiError ? err.message : "Couldn't refresh.");
    }
  }, [track]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        <p role={problem ? "alert" : "status"}>{problem ?? "Loading cheques…"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <Header names={state.companies} onChanged={refresh} />
      {problem && (
        <p role="alert" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          {problem} Showing the last data loaded; trying again shortly.
        </p>
      )}
      <SyncStatus sync={state.sync} now={state.now} />
      <FundingCalendar days={buildCalendar(state.cheques, state.today, state.holidays)} names={state.companies} />
      <Register cheques={state.cheques} names={state.companies} holidays={state.holidays} onChanged={refresh} />
      <Holidays holidays={state.holidays} today={state.today} onChanged={refresh} />
    </main>
  );
}
```

`lib/sync.ts` starts with `import "server-only"`, and the components import only its **type**, which TypeScript erases, so the client bundle is unaffected. `lib/sync-status.ts` likewise imports only the type.

- [ ] **Step 6: Typecheck, test and build**

Run: `npm.cmd run typecheck` — expected: no errors.
Run: `npm.cmd test` — expected: PASS.
Run (PowerShell): `$env:NEXT_DIST_DIR=".next-check"; npm.cmd run build; Remove-Item Env:NEXT_DIST_DIR; Remove-Item -Recurse -Force .next-check`
Expected: "Compiled successfully"; routes include `/api/sync` and no `/api/cheques` (only `/api/cheques/[id]`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sync): page shows the sync state and rows to fix; status buttons and new cheque form removed"
```

---

### Task 7: The sheet script, README, and a local end-to-end check

**Files:**
- Create: `sheet-script/Code.gs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `POST /api/sync` (Task 5) and its report (Task 4).
- Produces: the script the sheet's owner pastes in, and the going-live steps.

- [ ] **Step 1: Write `sheet-script/Code.gs`**

```js
// Cheque tracker sync. Paste this into the sheet (Extensions > Apps Script), then set
// APP_URL and SYNC_KEY under Project Settings > Script Properties.
// It reads the Check Issuances tab, fills the "Tracker ID" column and sends the rows to the
// tracker. Every rule about what a row means lives in the tracker, not here.

const TAB = "Check Issuances";
const SI_TABS = { wwj: ["WWJ SI"], wythlae: ["Wythlae SI"], wwjcorp: ["WWJ Corp SI"] };
const HEADERS = {
  date: "Date",
  supplier: "Name of Supplier",
  chequeNo: "Check Number",
  amount: "Amount",
  chequeDate: "Cheque Date",
  status: "Check Status",
  reference: "CR No./ SI No.",
};
const ID_HEADER = "Tracker ID";
const PAYMENT_HEADER = "Payment Details";
const MENU = "Cheque tracker";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(MENU)
    .addItem("Check against the tracker (no changes)", "menuCheck")
    .addItem("Sync now", "menuSync")
    .addItem("Sync now, allowing removals", "menuSyncAllowingRemovals")
    .addSeparator()
    .addItem("Give existing rows their IDs (one time)", "menuGiveExistingIds")
    .addItem("Turn automatic sync on", "menuAutoOn")
    .addItem("Turn automatic sync off", "menuAutoOff")
    .addToUi();
}

function norm_(value) {
  return String(value).trim().toLowerCase();
}

/** Column index (0-based) of each named header in row 1. Throws, naming any that is missing. */
function findColumns_(sheet, wanted) {
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(norm_);
  const found = {};
  Object.keys(wanted).forEach(function (key) {
    const index = header.indexOf(norm_(wanted[key]));
    if (index < 0) throw new Error('The "' + sheet.getName() + '" tab has no "' + wanted[key] + '" column.');
    found[key] = index;
  });
  return found;
}

function tab_(name) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('This spreadsheet has no "' + name + '" tab.');
  return sheet;
}

/** 0-based index of the Tracker ID column, or -1 when it does not exist yet. */
function idColumn_(sheet) {
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(norm_);
  return header.indexOf(norm_(ID_HEADER));
}

function newId_() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "sh-";
  for (let i = 0; i < 10; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}

/**
 * Reads the cheque rows. Fills a blank Tracker ID, and replaces one that repeats an ID
 * higher up (a copied row), then writes the ID column back once.
 */
function readRows_() {
  const sheet = tab_(TAB);
  const cols = findColumns_(sheet, HEADERS);
  const idCol = idColumn_(sheet);
  if (idCol < 0) throw new Error('Run "Give existing rows their IDs (one time)" from the ' + MENU + " menu first.");

  const range = sheet.getDataRange();
  const values = range.getValues();
  const shown = range.getDisplayValues();
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dateOf = function (r, c) {
    const v = values[r][c];
    return v instanceof Date ? Utilities.formatDate(v, zone, "yyyy-MM-dd") : shown[r][c].trim();
  };

  const seen = {};
  const ids = [];
  let idsChanged = false;
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    let id = shown[r][idCol] ? shown[r][idCol].trim() : "";
    const isCheque = shown[r][cols.supplier].trim() || shown[r][cols.chequeNo].trim() || shown[r][cols.amount].trim();
    if (!isCheque) {
      ids.push([id]);
      continue;
    }
    if (!id || seen[id]) {
      id = newId_();
      idsChanged = true;
    }
    seen[id] = true;
    ids.push([id]);
    const amount = values[r][cols.amount];
    rows.push({
      id: id,
      row: r + 1,
      date: dateOf(r, cols.date),
      supplier: shown[r][cols.supplier],
      chequeNo: shown[r][cols.chequeNo],
      amount: typeof amount === "number" ? amount : shown[r][cols.amount],
      chequeDate: dateOf(r, cols.chequeDate),
      status: shown[r][cols.status],
      reference: shown[r][cols.reference],
    });
  }
  if (idsChanged && ids.length) sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
  return rows;
}

/** The Payment Details text of each company's SI tab(s). */
function readSiRefs_() {
  const refs = {};
  Object.keys(SI_TABS).forEach(function (company) {
    refs[company] = SI_TABS[company]
      .map(function (name) {
        const sheet = tab_(name);
        const col = findColumns_(sheet, { payment: PAYMENT_HEADER }).payment;
        const last = sheet.getLastRow();
        if (last < 2) return "";
        return sheet
          .getRange(2, col + 1, last - 1, 1)
          .getDisplayValues()
          .map(function (row) {
            return row[0];
          })
          .join("\n");
      })
      .join("\n");
  });
  return refs;
}

/** Sends the tab to the tracker. Returns { ok, code, report | error }. */
function send_(options) {
  const props = PropertiesService.getScriptProperties();
  const url = (props.getProperty("APP_URL") || "").replace(/\/+$/, "");
  const key = props.getProperty("SYNC_KEY") || "";
  if (!url || !key) throw new Error("Set APP_URL and SYNC_KEY in Project Settings > Script Properties.");

  const body = {
    dryRun: !!options.dryRun,
    allowRemovals: !!options.allowRemovals,
    rows: readRows_(),
    siRefs: readSiRefs_(),
  };
  const response = UrlFetchApp.fetch(url + "/api/sync", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  let data = {};
  try {
    data = JSON.parse(response.getContentText());
  } catch (e) {
    data = { error: "The tracker did not answer properly (HTTP " + code + ")." };
  }
  return code === 200 ? { ok: true, code: code, report: data } : { ok: false, code: code, error: data.error || "HTTP " + code };
}

function describe_(result) {
  if (!result.ok) return "The tracker refused this:\n\n" + result.error;
  const r = result.report;
  const lines = [
    r.dryRun ? "Check only. Nothing was changed." : "Synced.",
    "",
    "Rows read: " + r.rows,
    "Added: " + r.added,
    "Changed: " + r.changed,
    "Removed: " + r.removed,
    "Unchanged: " + r.unchanged,
    "Rows to fix: " + r.problems.length,
  ];
  r.problems.slice(0, 15).forEach(function (p) {
    lines.push("  Row " + p.row + ": " + p.reason);
  });
  if (r.problems.length > 15) lines.push("  …and " + (r.problems.length - 15) + " more (see the tracker).");
  return lines.join("\n");
}

function runFromMenu_(options) {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(MENU, describe_(send_(options)), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(MENU, String(e.message || e), ui.ButtonSet.OK);
  }
}

function menuCheck() {
  runFromMenu_({ dryRun: true });
}
function menuSync() {
  runFromMenu_({});
}
function menuSyncAllowingRemovals() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    MENU,
    "Cheques that are no longer in this tab will be removed from the tracker, however many there are. Continue?",
    ui.ButtonSet.OK_CANCEL,
  );
  if (answer === ui.Button.OK) runFromMenu_({ allowRemovals: true });
}

/**
 * One time: adds the Tracker ID column and gives every existing cheque row "imp-<row number>",
 * the IDs the tracker already holds from the original import. Refuses if any ID exists.
 */
function menuGiveExistingIds() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = tab_(TAB);
    const cols = findColumns_(sheet, HEADERS);
    let idCol = idColumn_(sheet);
    const last = sheet.getLastRow();
    if (idCol >= 0 && last >= 2) {
      const existing = sheet.getRange(2, idCol + 1, last - 1, 1).getDisplayValues();
      const used = existing.some(function (row) {
        return row[0].trim() !== "";
      });
      if (used) throw new Error("The Tracker ID column already has IDs. This step is only for the first time.");
    }
    if (idCol < 0) {
      idCol = sheet.getLastColumn();
      sheet.getRange(1, idCol + 1).setValue(ID_HEADER);
    }
    if (last < 2) throw new Error("There are no cheque rows yet.");
    const shown = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
    let count = 0;
    const ids = shown.map(function (row, i) {
      const isCheque = row[cols.supplier].trim() || row[cols.chequeNo].trim() || row[cols.amount].trim();
      if (!isCheque) return [""];
      count++;
      return ["imp-" + (i + 2)];
    });
    sheet.getRange(2, idCol + 1, ids.length, 1).setValues(ids);
    ui.alert(MENU, count + " rows were given their IDs. Next: Check against the tracker (no changes).", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(MENU, String(e.message || e), ui.ButtonSet.OK);
  }
}

// ---- Automatic sync ----

function watched_() {
  let names = [TAB];
  Object.keys(SI_TABS).forEach(function (company) {
    names = names.concat(SI_TABS[company]);
  });
  return names;
}

/** Installable on-edit trigger: notes that something changed. The minute timer does the sending. */
function markChanged(e) {
  if (!e || !e.range) return;
  if (watched_().indexOf(e.range.getSheet().getName()) >= 0) {
    PropertiesService.getScriptProperties().setProperty("CHANGED", "1");
  }
}

/** Every minute: sends if something changed. On failure the flag is put back so the next minute retries. */
function syncIfChanged() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("CHANGED") !== "1") return;
  autoSync_();
}

/** Every hour: sends regardless. */
function syncHourly() {
  autoSync_();
}

function autoSync_() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    // Cleared before sending, so an edit made while sending is not lost.
    props.deleteProperty("CHANGED");
    const result = send_({});
    if (!result.ok) {
      props.setProperty("CHANGED", "1");
      console.error("Cheque tracker sync refused: " + result.error);
    }
  } catch (e) {
    props.setProperty("CHANGED", "1");
    console.error("Cheque tracker sync failed: " + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === "markChanged" || fn === "syncIfChanged" || fn === "syncHourly") ScriptApp.deleteTrigger(trigger);
  });
}

function menuAutoOn() {
  removeTriggers_();
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger("markChanged").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("syncIfChanged").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("syncHourly").timeBased().everyHours(1).create();
  PropertiesService.getScriptProperties().setProperty("CHANGED", "1");
  SpreadsheetApp.getUi().alert(MENU, "Automatic sync is on. Edits reach the tracker within about a minute.", SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuAutoOff() {
  removeTriggers_();
  SpreadsheetApp.getUi().alert(MENU, "Automatic sync is off.", SpreadsheetApp.getUi().ButtonSet.OK);
}
```

Check the script parses as JavaScript:
```bash
cp sheet-script/Code.gs "$TEMP/cheque-sync-check.js" && node --check "$TEMP/cheque-sync-check.js"
```
Expected: no output (exit code 0).

- [ ] **Step 2: Add the README section**

Append to `README.md`:
````markdown

## Sync from the Google Sheet

Cheques and their status come from the "Check Issuances" tab of the Supplier Invoices Register Log.
A script in the sheet sends the tab to this app within about a minute of an edit. The app never
writes to the sheet; the script writes only its "Tracker ID" column. Design:
`docs/superpowers/specs/2026-10-03-sheet-sync-design.md`.

Set up, once the app is deployed and the cheques are loaded:

1. Set the secret on Fly.io (at least 32 characters; keep it private):
   ```
   & $fly secrets set SYNC_KEY="<long random text>" --app wwj-cheques
   ```
2. **Try it on a copy first.** In Google Sheets: File > Make a copy. In the copy: Extensions > Apps
   Script, paste `sheet-script/Code.gs`, save. Under Project Settings > Script Properties add
   `APP_URL` (e.g. `https://wwj-cheques.fly.dev`) and `SYNC_KEY`. Reload the sheet; a "Cheque tracker"
   menu appears. Run "Give existing rows their IDs (one time)", then "Check against the tracker (no
   changes)". Use only the check on the copy.
3. Expect: Removed 0; Added only cheques entered since the cheques were loaded; Changed only where
   the sheet was edited since, or where the company rules differ from the first import.
4. Repeat step 2 in the real sheet, using an account that will keep edit access (the sync runs as
   that account). Run the check again, then "Sync now", then "Turn automatic sync on".

If many rows are deleted on purpose, a sync is refused once it would remove more than 20 cheques;
use "Sync now, allowing removals". Rows the app cannot read are listed on the page under "Sheet rows
to fix" and skipped until corrected.
````

- [ ] **Step 3: Local end-to-end check against the real data (nothing is committed)**

With the dev server running (log outside the project) and `data/cheques-import.imported-2026-10-03.json` present, build a dry-run sync from the same data the app was loaded with and post it. In Git Bash:
```bash
node -e "
const f=JSON.parse(require('fs').readFileSync('data/cheques-import.imported-2026-10-03.json','utf8'));
const word={cleared:'Cleared',issued:'Released to Supplier',voided:'Cancelled',pending:'With Christine'};
const rows=f.cheques.map(c=>({id:c.id,row:c.sourceRow,date:c.encodedDate||'',supplier:c.payee,chequeNo:c.chequeNo,amount:c.amount===null?'':c.amount,chequeDate:c.issueDate||'',status:word[c.status],reference:c.particulars}));
fetch('http://localhost:3002/api/sync',{method:'POST',headers:{authorization:'Bearer dev-only-sync-key-not-for-production-0000','content-type':'application/json'},body:JSON.stringify({dryRun:true,rows,siRefs:{}})}).then(async r=>{const j=await r.json();console.log(r.status,JSON.stringify({...j,problems:j.problems?.length}));});
"
```
Expected: `200` with `rows: 585`, `added: 0`, `removed: 0`, `problems: 0`. `changed` is the number of cheques whose company the rules decide differently without the SI tabs: about 98 (the cheques first assigned from the SI tabs, since this check sends none), plus any where the label rules differ from the first import. Record the exact number. Then confirm in the page that nothing changed (it was a dry run) and that the sync line still reads "Not yet connected to the sheet."

If `added` or `removed` is not 0, or `problems` is not 0, stop and find out why before going on.

- [ ] **Step 4: Browser check**

Sign in at http://localhost:3002 and check: no status buttons and no New cheque form; "Not yet connected to the sheet." under the header; the register note about the sheet; changing a row's company shows "Set here" under it (change it back afterwards is not possible to unlock, so use one Unassigned cheque and set it to the company it belongs to, or restore the database from `data/backups/` afterwards).

- [ ] **Step 5: Run everything once more and commit**

Run: `npm.cmd test` — expected: PASS.
Run: `npm.cmd run typecheck` — expected: no errors.

```bash
git add -A
git commit -m "feat(sync): Google Sheet script and setup guide"
```

- [ ] **Step 6: Hand over**

The owner does the README steps under "Sync from the Google Sheet" after the Fly.io deploy. Report the dry-run numbers from Step 3.
