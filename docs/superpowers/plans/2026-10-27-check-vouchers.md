# Check Vouchers (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A numbered, printable Check Voucher for any cheque in the tracker, with its invoice lines filled from the sheet's SI tabs and editable before printing.

**Architecture:** Four new tables (`invoices`, `voucher_series`, `vouchers`, `voucher_lines`). The sheet script sends each SI tab's rows; the sync stores them as `invoices`. `lib/vouchers.ts` creates a voucher for a cheque (next number in the company's series, lines matched by cheque number), and loads, saves, lists and deletes vouchers. Two new pages: `/vouchers` (list) and `/vouchers/[id]` (editor with a print preview). The amount-in-words and the matching rule are pure, tested modules.

**Tech Stack:** As the app today (Next.js 15.5, Postgres via `pg` and PGlite, Vitest). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-27-check-vouchers-design.md`

## Global Constraints

- Project folder `C:\WWJ\Claude Coding\Cheques`; use `npm.cmd` / `npx.cmd`. Tests: `npm.cmd test`. Typecheck: `npm.cmd run typecheck`.
- Money columns are `numeric(14,2)` and are read back with `Number(...)`; sums are done in centavos. Dates are text `YYYY-MM-DD`; blank allowed where the spec says so.
- Series prefixes: `WWJ-CV-`, `WYT-CV-`, `WWJC-CV-`; four digits, zero-padded; never reused.
- Amount in words: capitals, Philippine style, `… PESOS AND 43/100`; singular `PESO` only for exactly one peso.
- Invoice matching uses the whole-number rule already in `lib/company-rules.ts` (digits of 5 or more, not part of a longer number, not the start of an amount), own company's tab only.
- A voucher for a `cleared` or `voided` cheque cannot be deleted.
- Real payees and amounts never enter git or tests; tests use made-up data.
- Never write a log file inside the project while `next dev` runs.
- Run `npm.cmd run migrate` against production before pushing (new tables).
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Two people click Voucher on two cheques of the same company at the same moment.** They get different numbers; nothing is skipped or duplicated. Test in Task 3 (series row lock, checked with sequential calls; the lock itself is Postgres's).
2. **A cheque number that is part of a longer number or an amount in Payment Details** ("65351" inside "653511", "164973" inside "164,973.75"). Not matched. Test in Task 2.
3. **The sheet still runs the old script** after the deploy (no `invoices` in the payload). The sync keeps working and vouchers can be made with empty lines. Test in Task 2.
4. **The cheque behind a voucher is removed from the sheet.** The voucher survives with `chequeId = null`, and its page says so. Test in Task 3.
5. **Line amounts typed with commas, blank, or as text.** "12,500.50" and blank are accepted; "abc" is refused naming the line. Test in Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `db/migrations/004_vouchers.sql` (new) | The four tables |
| `lib/words.ts` (new) | `amountInWords` |
| `lib/invoices.ts` (new) | Read SI rows from the sync, store them, match them to a cheque |
| `lib/vouchers.ts` (new) | Voucher store: create with number, load, list, save, delete; company details |
| `lib/sync.ts`, `lib/company-rules.ts`, `lib/http.ts`, `tests/db.ts`, `tests/migrate.test.ts` | Small changes |
| `app/api/vouchers/route.ts`, `app/api/vouchers/[id]/route.ts`, `app/api/invoices/route.ts`, `app/api/company-details/route.ts` (new), `app/api/state/route.ts` | Routes |
| `app/vouchers/page.tsx`, `app/vouchers/[id]/page.tsx`, `components/vouchers-list.tsx`, `components/voucher-editor.tsx` (new) | Pages |
| `components/register.tsx`, `components/header.tsx`, `components/tracker.tsx`, `app/globals.css` | Voucher button, company details, nav, print CSS |
| `sheet-script/Code.gs` | Send SI rows |

---

### Task 1: Tables, and the amount in words

**Files:**
- Create: `db/migrations/004_vouchers.sql`, `lib/words.ts`
- Modify: `tests/db.ts`, `tests/migrate.test.ts`
- Test: `tests/words.test.ts`

**Interfaces:**
- Produces: `amountInWords(amount: number): string`; the tables in the spec §3.

- [ ] **Step 1: Write the failing tests**

In `tests/migrate.test.ts`, the applied list becomes `["001_init.sql", "002_balances.sql", "003_status_changed_at.sql", "004_vouchers.sql"]` and the table list becomes `["balances", "cheques", "config", "holidays", "invoices", "login_failures", "schema_migrations", "voucher_lines", "voucher_series", "vouchers"]`.

In `tests/db.ts`, the TRUNCATE becomes `"TRUNCATE cheques, config, holidays, login_failures, balances, invoices, voucher_series, vouchers, voucher_lines"`.

`tests/words.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/words";

describe("amountInWords", () => {
  it("writes pesos and centavos the Philippine way, in capitals", () => {
    expect(amountInWords(106401.43)).toBe("ONE HUNDRED SIX THOUSAND FOUR HUNDRED ONE PESOS AND 43/100");
    expect(amountInWords(1)).toBe("ONE PESO AND 00/100");
    expect(amountInWords(1.5)).toBe("ONE PESO AND 50/100");
    expect(amountInWords(0.5)).toBe("ZERO PESOS AND 50/100");
    expect(amountInWords(0)).toBe("ZERO PESOS AND 00/100");
    expect(amountInWords(21)).toBe("TWENTY-ONE PESOS AND 00/100");
    expect(amountInWords(1015)).toBe("ONE THOUSAND FIFTEEN PESOS AND 00/100");
    expect(amountInWords(1000000)).toBe("ONE MILLION PESOS AND 00/100");
    expect(amountInWords(2000300.07)).toBe("TWO MILLION THREE HUNDRED PESOS AND 07/100");
    expect(amountInWords(999999999999.99)).toBe(
      "NINE HUNDRED NINETY-NINE BILLION NINE HUNDRED NINETY-NINE MILLION NINE HUNDRED NINETY-NINE THOUSAND NINE HUNDRED NINETY-NINE PESOS AND 99/100",
    );
  });
  it("rounds to centavos first, so 0.999 is one peso", () => {
    expect(amountInWords(0.999)).toBe("ONE PESO AND 00/100");
  });
  it("refuses a negative or unreadable amount", () => {
    expect(() => amountInWords(-1)).toThrow();
    expect(() => amountInWords(Number.NaN)).toThrow();
    expect(() => amountInWords(1e12)).toThrow();
  });
});
```

Run: `npm.cmd test` — expected: FAIL (`@/lib/words` missing; the migrate test fails on the lists).

- [ ] **Step 2: Write the migration and the words module**

`db/migrations/004_vouchers.sql`:
```sql
-- Check vouchers (phase 1): one printable voucher per cheque, with invoice lines.

-- A copy of each company's SI tab from the sheet, replaced on every sync. Used only to suggest
-- a voucher's lines; the voucher keeps its own copy.
CREATE TABLE invoices (
  company         text NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp')),
  row             integer NOT NULL,
  invoice_date    text NOT NULL DEFAULT '',
  invoice_no      text NOT NULL DEFAULT '',
  supplier        text NOT NULL DEFAULT '',
  gross           numeric(14,2),
  payment_details text NOT NULL DEFAULT '',
  ewt             numeric(14,2),
  net             numeric(14,2),
  PRIMARY KEY (company, row)
);

-- The last voucher number given out per company. Numbers are never reused.
CREATE TABLE voucher_series (
  company     text PRIMARY KEY CHECK (company IN ('wwj','wythlae','wwjcorp')),
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE vouchers (
  id           text PRIMARY KEY,
  number       text NOT NULL UNIQUE,
  company      text NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp')),
  cheque_id    text UNIQUE REFERENCES cheques(id) ON DELETE SET NULL,
  voucher_date text NOT NULL,
  payee        text NOT NULL DEFAULT '',
  amount       numeric(14,2) NOT NULL,
  prepared_by  text NOT NULL DEFAULT '',
  checked_by   text NOT NULL DEFAULT '',
  approved_by  text NOT NULL DEFAULT '',
  received_by  text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);

CREATE TABLE voucher_lines (
  id           text PRIMARY KEY,
  voucher_id   text NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  invoice_no   text NOT NULL DEFAULT '',
  invoice_date text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  gross        numeric(14,2),
  ewt          numeric(14,2),
  net          numeric(14,2)
);
CREATE INDEX voucher_lines_voucher ON voucher_lines (voucher_id, position);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
```

`lib/words.ts`:
```ts
// Amounts in words for the printed voucher, Philippine style: "ONE PESO AND 50/100".

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const GROUPS = ["", "THOUSAND", "MILLION", "BILLION"];

/** 1 to 999 in words. */
function small(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`);
  const rest = n % 100;
  if (rest >= 20) parts.push(ONES[rest % 10] ? `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}` : TENS[Math.floor(rest / 10)]);
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) throw new Error(`Cannot write ${amount} in words.`);
  const centavos = Math.round(amount * 100);
  let pesos = Math.floor(centavos / 100);
  const cents = centavos % 100;
  const words: string[] = [];
  for (let g = 0; pesos > 0; g++) {
    const chunk = pesos % 1000;
    if (chunk) words.unshift(GROUPS[g] ? `${small(chunk)} ${GROUPS[g]}` : small(chunk));
    pesos = Math.floor(pesos / 1000);
  }
  const whole = Math.floor(centavos / 100);
  return `${words.length ? words.join(" ") : "ZERO"} ${whole === 1 ? "PESO" : "PESOS"} AND ${String(cents).padStart(2, "0")}/100`;
}
```

- [ ] **Step 3: Run tests and commit**

Run: `npm.cmd test` — expected: PASS.

```bash
git add -A
git commit -m "feat(vouchers): tables for vouchers and invoices; amount in words"
```

---

### Task 2: Invoice rows from the sheet

**Files:**
- Create: `lib/invoices.ts`
- Modify: `lib/company-rules.ts` (export the whole-number test), `lib/sync.ts` (accept and store `invoices`), `sheet-script/Code.gs` (send the SI rows)
- Test: `tests/invoices.test.ts`; additions to `tests/sync.test.ts`

**Interfaces:**
- Produces:
  - `lib/company-rules.ts`: `mentionsNumber(text: string, chequeNo: string): boolean` (the existing rule, now shared)
  - `lib/invoices.ts`: `type InvoiceRow = { company: Trading; row: number; invoiceDate: string; invoiceNo: string; supplier: string; gross: number | null; paymentDetails: string; ewt: number | null; net: number | null }`; `readInvoiceRows(company: Trading, raw: unknown): InvoiceRow[]`; `replaceInvoices(sql, rows: InvoiceRow[]): Promise<void>`; `listInvoices(sql, company): Promise<InvoiceRow[]>`; `invoicesForCheque(sql, company: Trading, chequeNo: string): Promise<InvoiceRow[]>`
  - `SyncPayload.invoices?: Partial<Record<Trading, unknown[]>>`; `applySync` replaces the table when present.

- [ ] **Step 1: Write the failing tests**

`tests/invoices.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { mentionsNumber } from "@/lib/company-rules";
import { invoicesForCheque, listInvoices, readInvoiceRows, replaceInvoices, type InvoiceRow } from "@/lib/invoices";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const raw = (over: Record<string, unknown> = {}) => ({
  row: 2,
  date: "2026-01-07",
  invoiceNo: "52089",
  supplier: "Sample Ingredients Inc.",
  gross: 65280,
  paymentDetails: "CBC 642848 75,079.61",
  ewt: "₱582.86",
  net: "64,697.14",
  ...over,
});

describe("mentionsNumber", () => {
  it("finds the cheque number as a whole number only", () => {
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "653511")).toBe(true);
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "65351")).toBe(false);
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "164973")).toBe(false);
    expect(mentionsNumber("CBC WWJ 667033 75,500; MBTC REF 384162 2,000", "WWJ667033")).toBe(true);
    expect(mentionsNumber("anything", "")).toBe(false);
    expect(mentionsNumber("1234 only", "1234")).toBe(false);
  });
});

describe("readInvoiceRows", () => {
  it("reads a row with typed amounts and dates", () => {
    expect(readInvoiceRows("wythlae", [raw()])).toEqual([
      {
        company: "wythlae", row: 2, invoiceDate: "2026-01-07", invoiceNo: "52089", supplier: "Sample Ingredients Inc.",
        gross: 65280, paymentDetails: "CBC 642848 75,079.61", ewt: 582.86, net: 64697.14,
      },
    ]);
  });
  it("keeps a row with an unreadable amount or date, as null or blank, rather than failing", () => {
    const [r] = readInvoiceRows("wwj", [raw({ gross: "n/a", date: "29/01/26", ewt: 0, net: "" })]);
    expect(r).toMatchObject({ gross: null, invoiceDate: "", ewt: 0, net: null });
  });
  it("skips blank rows and rows that are not objects, and numbers rows by position when row is missing", () => {
    const rows = readInvoiceRows("wwj", [raw({ row: undefined, supplier: "", invoiceNo: "", gross: "" }), null, raw({ row: undefined })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toBe(4);
  });
  it("returns nothing for input that is not a list", () => {
    expect(readInvoiceRows("wwj", "x")).toEqual([]);
  });
});

describe("invoices store", () => {
  const rows: InvoiceRow[] = [
    ...readInvoiceRows("wythlae", [raw(), raw({ row: 3, invoiceNo: "52090", paymentDetails: "CBC 642848 75,079.61" })]),
    ...readInvoiceRows("wwj", [raw({ row: 2, invoiceNo: "9", paymentDetails: "wwj cbc 642848 1.00" })]),
  ];

  it("replaces everything on each sync", async () => {
    await replaceInvoices(sql, rows);
    expect((await listInvoices(sql, "wythlae")).map((r) => r.invoiceNo)).toEqual(["52089", "52090"]);
    await replaceInvoices(sql, rows.slice(0, 1));
    expect(await listInvoices(sql, "wythlae")).toHaveLength(1);
    expect(await listInvoices(sql, "wwj")).toEqual([]);
  });

  it("finds the invoices a cheque pays, from the cheque's own company only, in sheet order", async () => {
    await replaceInvoices(sql, rows);
    expect((await invoicesForCheque(sql, "wythlae", "642848")).map((r) => r.invoiceNo)).toEqual(["52089", "52090"]);
    expect(await invoicesForCheque(sql, "wwjcorp", "642848")).toEqual([]);
    expect(await invoicesForCheque(sql, "wythlae", "")).toEqual([]);
    expect(await invoicesForCheque(sql, "wythlae", "4284")).toEqual([]);
  });
});
```

Append to `tests/sync.test.ts`:
```ts
describe("invoices in a sync", () => {
  it("stores the SI rows that come with a sync, replacing the last ones", async () => {
    const { listInvoices } = await import("@/lib/invoices");
    const invoices = { wythlae: [{ row: 2, date: "2026-01-07", invoiceNo: "52089", supplier: "S", gross: 10, paymentDetails: "CBC 590002 10.00", ewt: 0, net: 10 }] };
    await applySync(sql, payload([sheetRow(2)], { invoices }));
    expect((await listInvoices(sql, "wythlae")).map((r) => r.invoiceNo)).toEqual(["52089"]);
    await applySync(sql, payload([sheetRow(2)], { invoices: { wythlae: [] } }));
    expect(await listInvoices(sql, "wythlae")).toEqual([]);
  });

  it("leaves the stored SI rows alone when a sync sends none (an older script)", async () => {
    const { listInvoices } = await import("@/lib/invoices");
    await applySync(sql, payload([sheetRow(2)], { invoices: { wwj: [{ row: 2, invoiceNo: "1", supplier: "S", paymentDetails: "x" }] } }));
    await applySync(sql, payload([sheetRow(2)]));
    expect(await listInvoices(sql, "wwj")).toHaveLength(1);
  });

  it("does not store SI rows on a dry run", async () => {
    const { listInvoices } = await import("@/lib/invoices");
    await applySync(sql, payload([sheetRow(2)], { dryRun: true, invoices: { wwj: [{ row: 2, invoiceNo: "1", supplier: "S", paymentDetails: "x" }] } }));
    expect(await listInvoices(sql, "wwj")).toEqual([]);
  });
});

describe("parsePayload with invoices", () => {
  it("keeps the invoice lists for the three companies and drops anything else", () => {
    expect(parsePayload({ rows: [], invoices: { wwj: [{ row: 2 }], other: [1], wythlae: "x" } })!.invoices).toEqual({ wwj: [{ row: 2 }] });
    expect(parsePayload({ rows: [] })!.invoices).toBeUndefined();
  });
});
```
(`payload()` in that file spreads `over` into the payload, so `{ invoices }` works as is.)

Run: `npm.cmd test` — expected: FAIL (`@/lib/invoices` missing, `mentionsNumber` not exported).

- [ ] **Step 2: Write the code**

In `lib/company-rules.ts`, add above `deriveCompany` and use it inside:
```ts
/**
 * True when the cheque number's digits (5 or more) appear in the text as a whole number: not part
 * of a longer number and not the start of an amount like 164,973.75.
 */
export function mentionsNumber(text: string, chequeNo: string): boolean {
  const digits = chequeNo.replace(/\D/g, "");
  if (digits.length < 5) return false;
  return new RegExp(`(?<![\\d,.])${digits}(?!\\d|[,.]\\d)`).test(text);
}
```
and in `deriveCompany` replace the `digits` / `whole` block with:
```ts
  const hits = (["wwj", "wythlae", "wwjcorp"] as const).filter((co) => mentionsNumber(siRefs[co] ?? "", chequeNo));
  if (hits.length === 1) return { company: hits[0], basis: "si-crossref" };
```

`lib/invoices.ts`:
```ts
import "server-only";
import { mentionsNumber } from "./company-rules";
import { parseBalance } from "./money";
import type { Trading } from "./projection";
import { parseSheetDate } from "./sheet-rows";
import type { Sql } from "./sql";

// Each company's SI tab from the sheet: one row per supplier invoice, with the cheque that paid it
// named in "Payment Details". Replaced on every sync; used only to suggest a voucher's lines.

export type InvoiceRow = {
  company: Trading;
  row: number;
  invoiceDate: string;
  invoiceNo: string;
  supplier: string;
  gross: number | null;
  paymentDetails: string;
  ewt: number | null;
  net: number | null;
};

const text = (v: unknown) => (v == null ? "" : String(v).trim());

/** A money cell: a number, or text like "₱582.86"; blank or unreadable becomes null. */
function money(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? Math.round(v * 100) / 100 : parseBalance(v);
  return n === null || n < 0 ? null : n;
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
      row: typeof r.row === "number" ? r.row : index + 2,
      invoiceDate: parseSheetDate(r.date) ?? "",
      invoiceNo,
      supplier,
      gross,
      paymentDetails: text(r.paymentDetails),
      ewt: money(r.ewt),
      net: money(r.net),
    });
  });
  return rows;
}

const toRow = (r: Record<string, unknown>): InvoiceRow => ({
  company: r.company as Trading,
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
      `INSERT INTO invoices (company, row, invoice_date, invoice_no, supplier, gross, payment_details, ewt, net)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company, row) DO UPDATE SET invoice_date = excluded.invoice_date, invoice_no = excluded.invoice_no,
         supplier = excluded.supplier, gross = excluded.gross, payment_details = excluded.payment_details,
         ewt = excluded.ewt, net = excluded.net`,
      [r.company, r.row, r.invoiceDate, r.invoiceNo, r.supplier, r.gross, r.paymentDetails, r.ewt, r.net],
    );
  }
}

export async function listInvoices(sql: Sql, company: Trading): Promise<InvoiceRow[]> {
  return (await sql.query<Record<string, unknown>>("SELECT * FROM invoices WHERE company = $1 ORDER BY row", [company])).map(toRow);
}

/** The invoices this cheque pays, from its own company's tab, in sheet order. */
export async function invoicesForCheque(sql: Sql, company: Trading, chequeNo: string): Promise<InvoiceRow[]> {
  if (!chequeNo) return [];
  return (await listInvoices(sql, company)).filter((r) => mentionsNumber(r.paymentDetails, chequeNo));
}
```

In `lib/sync.ts`:
- `SyncPayload` gains `invoices?: Partial<Record<Trading, unknown[]>>` (import `type Trading` from `./projection`, and `readInvoiceRows`, `replaceInvoices` from `./invoices`).
- In `parsePayload`, after `siRefs`:
  ```ts
  let invoices: SyncPayload["invoices"];
  if (b.invoices && typeof b.invoices === "object" && !Array.isArray(b.invoices)) {
    for (const key of COMPANY_KEYS) {
      const list = (b.invoices as Record<string, unknown>)[key];
      if (Array.isArray(list)) (invoices ??= {})[key] = list;
    }
  }
  return { dryRun: …, allowRemovals: …, rows: …, siRefs, invoices };
  ```
  and the existing test expecting `toEqual({ dryRun: false, allowRemovals: false, rows: [...], siRefs: {} })` still passes because `invoices` is left `undefined` (toEqual ignores undefined properties).
- In `applySync`, inside the transaction just before the dry-run throw:
  ```ts
  if (payload.invoices) {
    const rows = COMPANY_KEYS.flatMap((co) => readInvoiceRows(co, payload.invoices![co] ?? []));
    await replaceInvoices(t, rows);
  }
  ```

In `sheet-script/Code.gs`, replace `readSiRefs_` with a function that reads each SI tab once and returns both the text and the rows:
```js
const SI_HEADERS = {
  invoiceNo: "Supplier Inv. No.",
  supplier: "Supplier",
  gross: "Total Purchases",
  paymentDetails: "Payment Details",
  ewt: "EWT Amount",
  net: "Amt Payable (Net of EWT)",
};

/** Each company's SI tab(s): the Payment Details text (for the company rules) and every row (for vouchers). */
function readSiTabs_() {
  const zone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const refs = {};
  const invoices = {};
  Object.keys(SI_TABS).forEach(function (company) {
    const texts = [];
    const rows = [];
    SI_TABS[company].forEach(function (name) {
      const sheet = tab_(name);
      const cols = findColumns_(sheet, SI_HEADERS);
      const header = headerRow_(sheet);
      let dateCol = header.indexOf("invoice date");
      if (dateCol < 0) dateCol = header.indexOf("date");
      const range = sheet.getDataRange();
      const values = range.getValues();
      const shown = range.getDisplayValues();
      for (let r = 1; r < values.length; r++) {
        const cell = function (c) {
          const v = values[r][c];
          return typeof v === "number" ? v : shown[r][c].trim();
        };
        const dateOf = function (c) {
          if (c < 0) return "";
          const v = values[r][c];
          return v instanceof Date ? Utilities.formatDate(v, zone, "yyyy-MM-dd") : shown[r][c].trim();
        };
        const invoiceNo = shown[r][cols.invoiceNo].trim();
        const supplier = shown[r][cols.supplier].trim();
        const gross = shown[r][cols.gross].trim();
        texts.push(shown[r][cols.paymentDetails]);
        if (!invoiceNo && !supplier && !gross) continue;
        rows.push({
          row: r + 1,
          date: dateOf(dateCol),
          invoiceNo: invoiceNo,
          supplier: supplier,
          gross: cell(cols.gross),
          paymentDetails: shown[r][cols.paymentDetails],
          ewt: cell(cols.ewt),
          net: cell(cols.net),
        });
      }
    });
    refs[company] = texts.join("\n");
    invoices[company] = rows;
  });
  return { refs: refs, invoices: invoices };
}
```
and in `send_` build the body as:
```js
  const si = readSiTabs_();
  const body = {
    dryRun: !!options.dryRun,
    allowRemovals: !!options.allowRemovals,
    rows: readRows_(!options.dryRun),
    siRefs: si.refs,
    invoices: si.invoices,
  };
```
Remove the old `readSiRefs_` and the `PAYMENT_HEADER` constant. Check the script parses: copy it to `$TEMP/cheque-sync-check.js` and run `node --check` on that copy.

- [ ] **Step 3: Run tests, typecheck, commit**

Run: `npm.cmd test` — expected: PASS. Run: `npm.cmd run typecheck` — expected: no errors.

```bash
git add -A
git commit -m "feat(vouchers): the sync stores each SI tab's invoice rows; cheque-number matching shared"
```

---

### Task 3: The voucher store

**Files:**
- Create: `lib/vouchers.ts`
- Modify: `lib/http.ts` (map `VoucherError`)
- Test: `tests/vouchers.test.ts`

**Interfaces:**
- Produces (all on `Sql`, all async unless noted):
  - `type VoucherLine = { id: string; position: number; invoiceNo: string; invoiceDate: string; description: string; gross: number | null; ewt: number | null; net: number | null }`
  - `type Voucher = { id: string; number: string; company: Trading; chequeId: string | null; voucherDate: string; payee: string; amount: number; preparedBy: string; checkedBy: string; approvedBy: string; receivedBy: string; notes: string; createdAt: number; updatedAt: number; lines: VoucherLine[] }`
  - `type VoucherSummary = Omit<Voucher, "lines"> & { chequeNo: string | null; chequeStatus: Status | null }`
  - `type VoucherInput = { voucherDate: string; payee: string; amount: number; preparedBy: string; checkedBy: string; approvedBy: string; receivedBy: string; notes: string; lines: Array<Omit<VoucherLine, "id" | "position">> }`
  - `class VoucherError extends Error { code: "not_found" | "unassigned" | "kept" }`
  - `SERIES_PREFIX: Record<Trading, string>`
  - `createVoucherForCheque(sql, chequeId, today, now?): Promise<Voucher>` (returns the existing voucher if there is one)
  - `getVoucher(sql, id): Promise<Voucher | null>`, `listVouchers(sql): Promise<VoucherSummary[]>`, `vouchersByCheque(sql): Promise<Record<string, string>>`
  - `validateVoucherInput(raw: unknown): { ok: true; value: VoucherInput } | { ok: false; errors: Record<string, string> }` (pure)
  - `updateVoucher(sql, id, input: VoucherInput, now?): Promise<Voucher>`, `deleteVoucher(sql, id): Promise<void>`
  - `type CompanyDetails = Record<Trading, { address: string; tin: string }>`; `getCompanyDetails(sql)`, `setCompanyDetails(sql, details)`

- [ ] **Step 1: Write the failing test**

`tests/vouchers.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { removeCheque, setCompany, upsertCheque } from "@/lib/cheques";
import { readInvoiceRows, replaceInvoices } from "@/lib/invoices";
import type { Sql } from "@/lib/sql";
import {
  createVoucherForCheque, deleteVoucher, getCompanyDetails, getVoucher, listVouchers, setCompanyDetails,
  updateVoucher, validateVoucherInput, VoucherError, vouchersByCheque, type VoucherInput,
} from "@/lib/vouchers";
import { resetDb, testSql } from "./db";
import { cheque } from "./helpers";

const TODAY = "2026-10-27";
let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
  await upsertCheque(sql, cheque({ id: "c1", company: "wythlae", chequeNo: "642848", payee: "Sample Ingredients Inc.", amount: 75079.61, issueDate: "2026-11-02" }));
  await upsertCheque(sql, cheque({ id: "c2", company: "wythlae", chequeNo: "642849", amount: 10 }));
  await upsertCheque(sql, cheque({ id: "c3", company: "wwj", chequeNo: "WWJ682052", amount: 20 }));
  await upsertCheque(sql, cheque({ id: "c4", company: "unassigned", chequeNo: "1", amount: 5 }));
  await replaceInvoices(sql, [
    ...readInvoiceRows("wythlae", [
      { row: 2, date: "2026-01-07", invoiceNo: "52089", supplier: "Sample Ingredients Inc.", gross: 65280, paymentDetails: "CBC 642848 75,079.61", ewt: 582.86, net: 64697.14 },
      { row: 3, date: "2026-01-07", invoiceNo: "52090", supplier: "Sample Ingredients Inc.", gross: 10476, paymentDetails: "CBC 642848 75,079.61", ewt: 93.54, net: 10382.46 },
      { row: 4, date: "2026-01-09", invoiceNo: "13707", supplier: "Other Supplier", gross: 7325, paymentDetails: "MB FT 7325.00", ewt: 0, net: 7325 },
    ]),
    ...readInvoiceRows("wwj", [{ row: 2, invoiceNo: "X", supplier: "WWJ Supplier", gross: 1, paymentDetails: "CBC 642848 1.00" }]),
  ]);
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "none";
  } catch (e) {
    return e instanceof VoucherError ? e.code : "other";
  }
};

describe("creating a voucher", () => {
  it("numbers it in the company's series and fills the lines from the sheet", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    expect(v).toMatchObject({ number: "WYT-CV-0001", company: "wythlae", chequeId: "c1", voucherDate: TODAY, payee: "Sample Ingredients Inc.", amount: 75079.61, createdAt: 1000 });
    expect(v.lines.map((l) => [l.position, l.invoiceNo, l.description, l.gross, l.ewt, l.net])).toEqual([
      [1, "52089", "Sample Ingredients Inc.", 65280, 582.86, 64697.14],
      [2, "52090", "Sample Ingredients Inc.", 10476, 93.54, 10382.46],
    ]);
  });

  it("gives each company its own series and never reuses a number", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    const b = await createVoucherForCheque(sql, "c2", TODAY);
    const c = await createVoucherForCheque(sql, "c3", TODAY);
    expect([a.number, b.number, c.number]).toEqual(["WYT-CV-0001", "WYT-CV-0002", "WWJ-CV-0001"]);
    await deleteVoucher(sql, b.id);
    await upsertCheque(sql, cheque({ id: "c5", company: "wythlae", chequeNo: "7", amount: 1 }));
    expect((await createVoucherForCheque(sql, "c5", TODAY)).number).toBe("WYT-CV-0003");
  });

  it("returns the existing voucher instead of making a second one", async () => {
    const first = await createVoucherForCheque(sql, "c1", TODAY);
    const again = await createVoucherForCheque(sql, "c1", TODAY);
    expect(again.id).toBe(first.id);
    expect(await listVouchers(sql)).toHaveLength(1);
  });

  it("refuses an unassigned cheque and an unknown one", async () => {
    expect(await codeOf(createVoucherForCheque(sql, "c4", TODAY))).toBe("unassigned");
    expect(await codeOf(createVoucherForCheque(sql, "nope", TODAY))).toBe("not_found");
  });

  it("makes a voucher with no lines when the sheet has no matching invoices", async () => {
    expect((await createVoucherForCheque(sql, "c2", TODAY)).lines).toEqual([]);
  });
});

describe("saving a voucher", () => {
  const input: VoucherInput = {
    voucherDate: "2026-10-28", payee: "Sample Ingredients Incorporated", amount: 75079.61,
    preparedBy: "A. Staff", checkedBy: "B. Staff", approvedBy: "C. Owner", receivedBy: "", notes: "October deliveries",
    lines: [
      { invoiceNo: "52089", invoiceDate: "2026-01-07", description: "Flour", gross: 65280, ewt: 582.86, net: 64697.14 },
      { invoiceNo: "", invoiceDate: "", description: "Freight", gross: null, ewt: null, net: 10382.46 },
    ],
  };

  it("replaces the details and the lines, in order", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    const saved = await updateVoucher(sql, v.id, input, 2000);
    expect(saved).toMatchObject({ ...input, lines: expect.any(Array), updatedAt: 2000, number: "WYT-CV-0001" });
    expect(saved.lines.map((l) => [l.position, l.description, l.net])).toEqual([[1, "Flour", 64697.14], [2, "Freight", 10382.46]]);
    expect(await getVoucher(sql, v.id)).toEqual(saved);
  });

  it("reports an unknown voucher", async () => {
    expect(await codeOf(updateVoucher(sql, "nope", input))).toBe("not_found");
  });
});

describe("validateVoucherInput", () => {
  const good = {
    voucherDate: "2026-10-28", payee: " Sample ", amount: "75,079.61", preparedBy: "A", checkedBy: "", approvedBy: "", receivedBy: "", notes: "",
    lines: [{ invoiceNo: " 1 ", invoiceDate: "2026-01-07", description: "Flour", gross: "65,280", ewt: "", net: 64697.14 }],
  };
  it("accepts typed amounts and trims text", () => {
    const r = validateVoucherInput(good);
    expect(r.ok && r.value).toMatchObject({ payee: "Sample", amount: 75079.61, lines: [{ invoiceNo: "1", gross: 65280, ewt: null, net: 64697.14 }] });
  });
  it("names the field or line that is wrong", () => {
    const r = validateVoucherInput({ ...good, amount: "0", voucherDate: "2026-02-30", lines: [{ ...good.lines[0], gross: "abc" }, { description: "ok" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amount", "lines.1.gross", "voucherDate"]);
  });
  it("rejects a shape that is not a voucher", () => {
    expect(validateVoucherInput(null).ok).toBe(false);
    expect(validateVoucherInput({ ...good, lines: "x" }).ok).toBe(false);
  });
});

describe("listing and deleting", () => {
  it("lists newest first with the cheque's number and status, and maps cheques to vouchers", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    const b = await createVoucherForCheque(sql, "c3", TODAY, 2000);
    const list = await listVouchers(sql);
    expect(list.map((v) => v.number)).toEqual([b.number, a.number]);
    expect(list[1]).toMatchObject({ chequeNo: "642848", chequeStatus: "issued" });
    expect(await vouchersByCheque(sql)).toEqual({ c1: a.id, c3: b.id });
  });

  it("deletes a voucher for an issued cheque but keeps one for a cleared cheque", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await upsertCheque(sql, cheque({ id: "c3", company: "wwj", chequeNo: "WWJ682052", amount: 20, status: "cleared" }));
    const b = await createVoucherForCheque(sql, "c3", TODAY);
    expect(await codeOf(deleteVoucher(sql, b.id))).toBe("kept");
    await deleteVoucher(sql, a.id);
    expect(await getVoucher(sql, a.id)).toBeNull();
    expect(await codeOf(deleteVoucher(sql, "nope"))).toBe("not_found");
  });

  it("survives its cheque being removed from the sheet", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await removeCheque(sql, "c1");
    expect((await getVoucher(sql, a.id))!.chequeId).toBeNull();
    expect((await listVouchers(sql))[0]).toMatchObject({ chequeNo: null, chequeStatus: null });
    await deleteVoucher(sql, a.id);
  });

  it("keeps the voucher's company even if the cheque's company is changed later", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await setCompany(sql, "c1", "wwj");
    expect((await getVoucher(sql, a.id))!.company).toBe("wythlae");
  });
});

describe("company details", () => {
  it("starts blank and saves addresses and TINs", async () => {
    expect((await getCompanyDetails(sql)).wwj).toEqual({ address: "", tin: "" });
    await setCompanyDetails(sql, { wwj: { address: "1 Sample St, Cebu", tin: "000-000-000-000" }, wythlae: { address: "", tin: "" }, wwjcorp: { address: "", tin: "" } });
    expect((await getCompanyDetails(sql)).wwj).toEqual({ address: "1 Sample St, Cebu", tin: "000-000-000-000" });
  });
});
```

Run: `npm.cmd test` — expected: FAIL, cannot resolve `@/lib/vouchers`.

- [ ] **Step 2: Write `lib/vouchers.ts`**

```ts
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
export async function createVoucherForCheque(sql: Sql, chequeId: string, today: string, now: number = Date.now()): Promise<Voucher> {
  return sql.tx(async (t) => {
    const cheque = (await t.query<Row>("SELECT * FROM cheques WHERE id = $1", [chequeId]))[0];
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
      `INSERT INTO vouchers (id, number, company, cheque_id, voucher_date, payee, amount, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, number, company, chequeId, today, cheque.payee, cheque.amount ?? 0, now],
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

export function validateVoucherInput(raw: unknown): { ok: true; value: VoucherInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return { ok: false, errors: { form: "The request was not understood." } };
  const r = raw as Record<string, unknown>;
  if (!isValidDate(r.voucherDate)) errors.voucherDate = "Enter a valid voucher date.";
  const amount = parseAmount(r.amount);
  if (amount === null) errors.amount = "Enter an amount above zero.";
  if (!Array.isArray(r.lines)) errors.lines = "The lines were not understood.";
  const lines: VoucherInput["lines"] = [];
  for (const [i, item] of (Array.isArray(r.lines) ? r.lines : []).entries()) {
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

export async function updateVoucher(sql: Sql, id: string, input: VoucherInput, now: number = Date.now()): Promise<Voucher> {
  return sql.tx(async (t) => {
    const rows = await t.query<Row>(
      `UPDATE vouchers SET voucher_date = $2, payee = $3, amount = $4, prepared_by = $5, checked_by = $6, approved_by = $7,
         received_by = $8, notes = $9, updated_at = $10 WHERE id = $1 RETURNING *`,
      [id, input.voucherDate, input.payee, input.amount, input.preparedBy, input.checkedBy, input.approvedBy, input.receivedBy, input.notes, now],
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
```

In `lib/http.ts`, import `VoucherError` from `./vouchers` and, next to the `ChequeError` branch in `guarded`, add:
```ts
    if (err instanceof VoucherError) {
      const status = err.code === "not_found" ? 404 : err.code === "unassigned" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
```

- [ ] **Step 3: Run tests, typecheck, commit**

Run: `npm.cmd test` — expected: PASS. Run: `npm.cmd run typecheck` — expected: no errors.

```bash
git add -A
git commit -m "feat(vouchers): voucher store with per-company numbering, lines from the sheet, company details"
```

---

### Task 4: Routes

**Files:**
- Create: `app/api/vouchers/route.ts`, `app/api/vouchers/[id]/route.ts`, `app/api/invoices/route.ts`, `app/api/company-details/route.ts`
- Modify: `app/api/state/route.ts`

**Interfaces:**
- `GET /api/vouchers` → `VoucherSummary[]`
- `POST /api/vouchers` `{ chequeId }` → `200 Voucher` (new or existing) | 400 | 404
- `GET /api/vouchers/:id` → `{ voucher, cheque: { chequeNo, bankAccount, issueDate, status } | null, companyName, details: { address, tin } }` | 404
- `PUT /api/vouchers/:id` body `VoucherInput` → `200 Voucher` | `400 { error, errors }` | 404
- `DELETE /api/vouchers/:id` → `200 { id }` | 404 | 409
- `GET /api/invoices?chequeId=` → `InvoiceRow[]` matching that cheque (400 if the cheque is unassigned or missing)
- `PUT /api/company-details` body `CompanyDetails` → `200 CompanyDetails`
- `/api/state` adds `vouchers: Record<chequeId, voucherId>` and `companyDetails: CompanyDetails`

- [ ] **Step 1: Write the routes**

`app/api/vouchers/route.ts`:
```ts
import { NextResponse } from "next/server";
import { todayManila } from "@/lib/dates";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { createVoucherForCheque, listVouchers } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () => NextResponse.json(await listVouchers(await getSql())));
}

export function POST(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body || typeof body.chequeId !== "string") return badRequest("The request was not understood.");
    return NextResponse.json(await createVoucherForCheque(await getSql(), body.chequeId, todayManila()));
  });
}
```

`app/api/vouchers/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getCompanyNames, listCheques } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { companyLabel } from "@/lib/types";
import { deleteVoucher, getCompanyDetails, getVoucher, updateVoucher, validateVoucherInput } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "This voucher no longer exists." }, { status: 404 });

export function GET(_req: Request, { params }: Params) {
  return guarded(async () => {
    const { id } = await params;
    const sql = await getSql();
    const voucher = await getVoucher(sql, id);
    if (!voucher) return notFound();
    const cheque = voucher.chequeId ? ((await listCheques(sql)).find((c) => c.id === voucher.chequeId) ?? null) : null;
    const [names, details] = await Promise.all([getCompanyNames(sql), getCompanyDetails(sql)]);
    return NextResponse.json({
      voucher,
      cheque: cheque ? { chequeNo: cheque.chequeNo, bankAccount: cheque.bankAccount, issueDate: cheque.issueDate, status: cheque.status } : null,
      companyName: companyLabel(names, voucher.company),
      details: details[voucher.company],
    });
  });
}

export function PUT(req: Request, { params }: Params) {
  return guarded(async () => {
    const { id } = await params;
    const v = validateVoucherInput(await readObject(req));
    if (!v.ok) return badRequest("Fix the highlighted fields.", v.errors);
    return NextResponse.json(await updateVoucher(await getSql(), id, v.value));
  });
}

export function DELETE(_req: Request, { params }: Params) {
  return guarded(async () => {
    const { id } = await params;
    await deleteVoucher(await getSql(), id);
    return NextResponse.json({ id });
  });
}
```

`app/api/invoices/route.ts`:
```ts
import { NextResponse } from "next/server";
import { listCheques } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded } from "@/lib/http";
import { invoicesForCheque } from "@/lib/invoices";
import { TRADING, type Trading } from "@/lib/projection";

export const dynamic = "force-dynamic";

// The sheet's invoices that a cheque pays, for the voucher page's "Fill from sheet" button.
export function GET(req: Request) {
  return guarded(async () => {
    const chequeId = new URL(req.url).searchParams.get("chequeId") ?? "";
    const sql = await getSql();
    const cheque = (await listCheques(sql)).find((c) => c.id === chequeId);
    if (!cheque) return badRequest("This cheque no longer exists.");
    if (!TRADING.includes(cheque.company as Trading)) return badRequest("Choose a company for this cheque first.");
    return NextResponse.json(await invoicesForCheque(sql, cheque.company as Trading, cheque.chequeNo));
  });
}
```

`app/api/company-details/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { setCompanyDetails, type CompanyDetails } from "@/lib/vouchers";

export function PUT(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    return NextResponse.json(await setCompanyDetails(await getSql(), body as CompanyDetails));
  });
}
```

In `app/api/state/route.ts`, add `vouchersByCheque(sql)` and `getCompanyDetails(sql)` to the `Promise.all` (imports from `@/lib/vouchers`) and return them as `vouchers` and `companyDetails`.

- [ ] **Step 2: Typecheck, build, commit**

Run: `npm.cmd run typecheck` — expected: no errors. Run a build into `.next-check` (as in earlier plans) — expected: "Compiled successfully" with `/api/vouchers`, `/api/vouchers/[id]`, `/api/invoices`, `/api/company-details` listed; remove `.next-check`.

```bash
git add -A
git commit -m "feat(vouchers): routes for vouchers, invoices and company details"
```

---

### Task 5: The pages

**Files:**
- Create: `app/vouchers/page.tsx`, `app/vouchers/[id]/page.tsx`, `components/vouchers-list.tsx`, `components/voucher-editor.tsx`
- Modify: `components/register.tsx` (Voucher button), `components/header.tsx` (Vouchers link; address and TIN in Edit names), `components/tracker.tsx` (pass `vouchers`), `app/globals.css` (print rules)

**Interfaces:**
- Consumes: the routes of Task 4; `amountInWords`; `peso`; `shortDate`; `manilaTime`.

- [ ] **Step 1: Print rules and the list page**

Append to `app/globals.css`:
```css
@media print {
  @page {
    size: A4 portrait;
    margin: 14mm;
  }
  body {
    background: #fff;
    color: #000;
  }
  .print-hide {
    display: none !important;
  }
  .voucher-sheet {
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    max-width: none !important;
  }
}
```

`app/vouchers/page.tsx`:
```tsx
import { VouchersList } from "@/components/vouchers-list";

export const metadata = { title: "Vouchers · Cheque Funding Tracker" };

export default function Page() {
  return <VouchersList />;
}
```

`components/vouchers-list.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { DEFAULT_COMPANY_NAMES, companyLabel } from "@/lib/types";
import type { VoucherSummary } from "@/lib/vouchers";

export function VouchersList() {
  const [list, setList] = useState<VoucherSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api<VoucherSummary[]>("/api/vouchers").then(setList, (err) => setProblem(err instanceof ApiError ? err.message : "Couldn't load the vouchers."));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = (list ?? []).filter(
    (v) => !q || v.payee.toLowerCase().includes(q) || v.number.toLowerCase().includes(q) || (v.chequeNo ?? "").toLowerCase().includes(q),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Check vouchers</h1>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>
      <p className="text-sm text-muted">A voucher is made from a cheque: use the Voucher button on a cheque in the register.</p>
      <input
        className="field max-w-md"
        placeholder="Search by payee, cheque no. or voucher no."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search vouchers"
      />
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {list && shown.length === 0 && <p className="text-sm text-muted">{list.length === 0 ? "No vouchers yet." : "No vouchers match."}</p>}
      <ul className="space-y-1.5 text-sm">
        {shown.map((v) => (
          <li key={v.id}>
            <Link
              href={`/vouchers/${v.id}`}
              className="grid gap-x-3 gap-y-1 rounded-lg border border-line bg-card p-3 hover:border-accent sm:grid-cols-[9rem_6rem_minmax(0,1fr)_8rem_9rem]"
            >
              <span className="font-mono font-medium">{v.number}</span>
              <span>{shortDate(v.voucherDate)}</span>
              <span className="truncate">{v.payee || "(no payee)"}</span>
              <span className="font-mono sm:text-right">{peso(v.amount)}</span>
              <span className="text-muted">
                {companyLabel(DEFAULT_COMPANY_NAMES, v.company)} · {v.chequeNo ?? "no cheque"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```
(The list uses the default company names; the voucher page itself uses the names and details saved in the app.)

- [ ] **Step 2: The voucher page**

`app/vouchers/[id]/page.tsx`:
```tsx
import { VoucherEditor } from "@/components/voucher-editor";

export const metadata = { title: "Voucher · Cheque Funding Tracker" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherEditor id={id} />;
}
```

`components/voucher-editor.tsx`:
```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import type { InvoiceRow } from "@/lib/invoices";
import { peso, sumAmounts } from "@/lib/money";
import type { Status } from "@/lib/types";
import type { Voucher, VoucherLine } from "@/lib/vouchers";
import { amountInWords } from "@/lib/words";

type View = {
  voucher: Voucher;
  cheque: { chequeNo: string; bankAccount: string; issueDate: string; status: Status } | null;
  companyName: string;
  details: { address: string; tin: string };
};

type LineDraft = { invoiceNo: string; invoiceDate: string; description: string; gross: string; ewt: string; net: string };
type Draft = {
  voucherDate: string; payee: string; amount: string; preparedBy: string; checkedBy: string; approvedBy: string; receivedBy: string; notes: string;
  lines: LineDraft[];
};

const money = (n: number | null) => (n === null ? "" : String(n));
const toDraft = (v: Voucher): Draft => ({
  voucherDate: v.voucherDate, payee: v.payee, amount: String(v.amount), preparedBy: v.preparedBy, checkedBy: v.checkedBy,
  approvedBy: v.approvedBy, receivedBy: v.receivedBy, notes: v.notes,
  lines: v.lines.map((l) => ({ invoiceNo: l.invoiceNo, invoiceDate: l.invoiceDate, description: l.description, gross: money(l.gross), ewt: money(l.ewt), net: money(l.net) })),
});
const blankLine = (): LineDraft => ({ invoiceNo: "", invoiceDate: "", description: "", gross: "", ewt: "", net: "" });
const asNumber = (s: string) => {
  const n = Number(s.replace(/[₱,\s]/g, ""));
  return s.trim() === "" || Number.isNaN(n) ? null : n;
};

export function VoucherEditor({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<View>(`/api/vouchers/${id}`).then(
      (v) => {
        setView(v);
        setDraft(toDraft(v.voucher));
      },
      (err) => setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Couldn't load the voucher." }),
    );
  }, [id]);

  if (!view || !draft) {
    return (
      <main className="mx-auto max-w-5xl p-6">
        <p role={message ? "alert" : "status"}>{message?.text ?? "Loading…"}</p>
      </main>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const setLine = (i: number, key: keyof LineDraft, value: string) =>
    setDraft({ ...draft, lines: draft.lines.map((l, n) => (n === i ? { ...l, [key]: value } : l)) });
  const amount = asNumber(draft.amount) ?? 0;
  const netTotal = sumAmounts(draft.lines.map((l) => asNumber(l.net)));
  const mismatch = draft.lines.length > 0 && Math.round(netTotal * 100) !== Math.round(amount * 100);

  async function save() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const saved = await api<Voucher>(`/api/vouchers/${id}`, "PUT", draft);
      setView({ ...view!, voucher: saved });
      setDraft(toDraft(saved));
      setMessage({ kind: "ok", text: "Saved." });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors ?? {});
        setMessage({ kind: "error", text: err.message });
      } else setMessage({ kind: "error", text: "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  async function fillFromSheet() {
    if (!view!.voucher.chequeId) return;
    setBusy(true);
    setMessage(null);
    try {
      const rows = await api<InvoiceRow[]>(`/api/invoices?chequeId=${encodeURIComponent(view!.voucher.chequeId)}`);
      if (rows.length === 0) setMessage({ kind: "error", text: "The sheet has no invoice naming this cheque number." });
      else {
        set(
          "lines",
          rows.map((r) => ({ invoiceNo: r.invoiceNo, invoiceDate: r.invoiceDate, description: r.supplier, gross: money(r.gross), ewt: money(r.ewt), net: money(r.net) })),
        );
        setMessage({ kind: "ok", text: `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} filled in from the sheet. Save to keep them.` });
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Delete voucher ${view!.voucher.number}? Its number will not be reused.`)) return;
    setBusy(true);
    try {
      await api(`/api/vouchers/${id}`, "DELETE");
      router.push("/vouchers");
      return;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    setBusy(false);
  }

  const v = view.voucher;
  const cheque = view.cheque;
  const canDelete = !cheque || cheque.status === "issued" || cheque.status === "pending";
  const field = (key: keyof Omit<Draft, "lines">, label: string, type = "text") => (
    <label className="space-y-1 text-sm">
      <span className="block text-muted">{label}</span>
      <input type={type} className="field" value={draft[key]} onChange={(e) => set(key, e.target.value)} aria-invalid={!!errors[key] || undefined} />
      {errors[key] && <span className="block text-danger">{errors[key]}</span>}
    </label>
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="print-hide flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Voucher {v.number}</h1>
        <Link href="/vouchers" className="btn">
          All vouchers
        </Link>
        <Link href="/" className="btn">
          Back to tracker
        </Link>
      </div>

      <section className="print-hide space-y-3 rounded-xl border border-line bg-card p-4">
        {cheque ? (
          <p className="text-sm text-muted">
            Cheque {cheque.chequeNo || "(no number)"} · {cheque.issueDate ? shortDate(cheque.issueDate) : "no date"} · {cheque.status}
            {cheque.bankAccount ? ` · ${cheque.bankAccount}` : ""}
          </p>
        ) : (
          <p className="text-sm text-warn-ink">This cheque is no longer in the sheet.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("voucherDate", "Voucher date", "date")}
          {field("payee", "Payee")}
          {field("amount", "Amount (₱)")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {field("preparedBy", "Prepared by")}
          {field("checkedBy", "Checked by")}
          {field("approvedBy", "Approved by")}
          {field("receivedBy", "Received by")}
        </div>
        <label className="block space-y-1 text-sm">
          <span className="block text-muted">Notes (printed under the particulars)</span>
          <textarea className="field h-20 py-2" value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Particulars</h2>
          <button type="button" className="btn" disabled={busy || !v.chequeId} onClick={fillFromSheet}>
            Fill from sheet
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => set("lines", [...draft.lines, blankLine()])}>
            Add line
          </button>
        </div>
        {draft.lines.length === 0 && <p className="text-sm text-muted">No lines yet. Fill from the sheet, or add a line.</p>}
        <ul className="space-y-2">
          {draft.lines.map((l, i) => (
            <li key={i} className="grid gap-2 rounded-lg border border-line p-2 text-sm sm:grid-cols-[7rem_8rem_minmax(0,1fr)_7rem_6rem_7rem_auto] sm:items-center">
              <input className="field" placeholder="Invoice no." value={l.invoiceNo} onChange={(e) => setLine(i, "invoiceNo", e.target.value)} aria-label={`Line ${i + 1} invoice no.`} />
              <input className="field" type="date" value={l.invoiceDate} onChange={(e) => setLine(i, "invoiceDate", e.target.value)} aria-label={`Line ${i + 1} date`} aria-invalid={!!errors[`lines.${i}.invoiceDate`] || undefined} />
              <input className="field" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} aria-label={`Line ${i + 1} description`} />
              <input className="field" placeholder="Gross" value={l.gross} onChange={(e) => setLine(i, "gross", e.target.value)} aria-label={`Line ${i + 1} gross`} aria-invalid={!!errors[`lines.${i}.gross`] || undefined} />
              <input className="field" placeholder="EWT" value={l.ewt} onChange={(e) => setLine(i, "ewt", e.target.value)} aria-label={`Line ${i + 1} EWT`} aria-invalid={!!errors[`lines.${i}.ewt`] || undefined} />
              <input className="field" placeholder="Net" value={l.net} onChange={(e) => setLine(i, "net", e.target.value)} aria-label={`Line ${i + 1} net`} aria-invalid={!!errors[`lines.${i}.net`] || undefined} />
              <button type="button" className="btn" onClick={() => set("lines", draft.lines.filter((_, n) => n !== i))} aria-label={`Remove line ${i + 1}`}>
                Remove
              </button>
              {Object.entries(errors)
                .filter(([k]) => k.startsWith(`lines.${i}.`))
                .map(([k, text]) => (
                  <span key={k} className="text-danger sm:col-span-7">
                    {text}
                  </span>
                ))}
            </li>
          ))}
        </ul>
        {mismatch && (
          <p className="text-sm text-warn-ink">
            The lines' net total is {peso(netTotal)}, but the voucher amount is {peso(amount)}. You can still print; check the figures.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary h-10 px-5" disabled={busy} onClick={save}>
            {busy ? "Working…" : "Save"}
          </button>
          <button type="button" className="btn h-10" onClick={() => window.print()}>
            Print
          </button>
          {canDelete && (
            <button type="button" className="btn h-10" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
              {message.text}
            </p>
          )}
        </div>
      </section>

      {/* The printed voucher. Shows the draft, so what you see is what prints. */}
      <section className="voucher-sheet mx-auto max-w-[190mm] space-y-4 rounded-xl border border-line bg-white p-8 text-sm text-black">
        <header className="text-center">
          <p className="text-lg font-semibold">{view.companyName}</p>
          {view.details.address && <p>{view.details.address}</p>}
          {view.details.tin && <p>TIN {view.details.tin}</p>}
          <p className="mt-2 text-base font-semibold tracking-wide">CHECK VOUCHER</p>
        </header>
        <div className="flex justify-between">
          <p>
            <span className="text-neutral-600">CV No.</span> <span className="font-mono font-semibold">{v.number}</span>
          </p>
          <p>
            <span className="text-neutral-600">Date</span> {draft.voucherDate ? shortDate(draft.voucherDate) + " " + draft.voucherDate.slice(0, 4) : ""}
          </p>
        </div>
        <p>
          <span className="text-neutral-600">Pay to</span> <span className="font-semibold">{draft.payee}</span>
        </p>
        <p>
          <span className="text-neutral-600">Amount</span> <span className="font-mono font-semibold">{peso(amount)}</span>
        </p>
        <p className="text-xs uppercase">{amount > 0 && amount < 1e12 ? amountInWords(amount) : ""}</p>
        {cheque && (
          <p>
            <span className="text-neutral-600">Cheque no.</span> {cheque.chequeNo || "—"}
            {cheque.bankAccount ? <> · {cheque.bankAccount}</> : null}
            {cheque.issueDate ? <> · dated {shortDate(cheque.issueDate)} {cheque.issueDate.slice(0, 4)}</> : null}
          </p>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">Invoice no.</th>
              <th className="py-1 pr-2">Date</th>
              <th className="py-1 pr-2">Particulars</th>
              <th className="py-1 pr-2 text-right">Gross</th>
              <th className="py-1 pr-2 text-right">EWT</th>
              <th className="py-1 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-300 align-top">
                <td className="py-1 pr-2 font-mono">{l.invoiceNo}</td>
                <td className="py-1 pr-2">{l.invoiceDate ? shortDate(l.invoiceDate) + " " + l.invoiceDate.slice(0, 4) : ""}</td>
                <td className="py-1 pr-2">{l.description}</td>
                <td className="py-1 pr-2 text-right font-mono">{asNumber(l.gross) === null ? "" : peso(asNumber(l.gross)!)}</td>
                <td className="py-1 pr-2 text-right font-mono">{asNumber(l.ewt) === null ? "" : peso(asNumber(l.ewt)!)}</td>
                <td className="py-1 text-right font-mono">{asNumber(l.net) === null ? "" : peso(asNumber(l.net)!)}</td>
              </tr>
            ))}
            {draft.lines.length > 0 && (
              <tr className="font-semibold">
                <td colSpan={5} className="py-1 pr-2 text-right">
                  Total
                </td>
                <td className="py-1 text-right font-mono">{peso(netTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {draft.notes && <p className="whitespace-pre-wrap">{draft.notes}</p>}
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 pt-6 sm:grid-cols-4">
          {(["preparedBy", "checkedBy", "approvedBy", "receivedBy"] as const).map((key, i) => (
            <div key={key} className="border-t border-black pt-1">
              <p className="text-xs text-neutral-600">{["Prepared by", "Checked by", "Approved by", "Received by"][i]}</p>
              <p className="min-h-5 font-medium">{draft[key]}</p>
              <p className="text-xs text-neutral-600">Signature / date</p>
            </div>
          ))}
        </div>
        <p className="pt-4 text-xs">
          Received from {view.companyName} the amount of {peso(amount)} in full payment of the above.
          <span className="ml-2 inline-block w-48 border-b border-black align-bottom" /> Payee / date
        </p>
      </section>
    </main>
  );
}
```
Note: `amountInWords` lives in `lib/words.ts`, which has no server-only import, so it can run in the browser.

- [ ] **Step 3: Register button, header link, company details, tracker state**

`components/register.tsx`:
- Add props `vouchers: Record<string, string>`; import `useRouter` from `next/navigation` and `useState` is already there.
- Add a function:
  ```ts
  async function openVoucher(c: Cheque) {
    const existing = vouchers[c.id];
    if (existing) return router.push(`/vouchers/${existing}`);
    setBusy(c.id);
    setRowError(null);
    try {
      const v = await api<{ id: string }>("/api/vouchers", "POST", { chequeId: c.id });
      router.push(`/vouchers/${v.id}`);
      return;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setRowError(`Cheque ${c.chequeNo || "(no number)"}, ${c.payee}: ${message}`);
    }
    setBusy(null);
  }
  ```
- Widen `GRID` to `md:grid-cols-[7rem_11rem_8rem_minmax(0,1fr)_8rem_5rem_6rem]`, add a `<span>Voucher</span>` to the header row, and after the status `<p>` in each row:
  ```tsx
  <button
    type="button"
    className="btn"
    disabled={busy === c.id || c.company === "unassigned"}
    title={c.company === "unassigned" ? "Choose a company first" : undefined}
    onClick={() => openVoucher(c)}
  >
    {vouchers[c.id] ? "Voucher" : "Make voucher"}
  </button>
  ```

`components/tracker.tsx`: `State` gains `vouchers: Record<string, string>` and `companyDetails: CompanyDetails` (type import from `@/lib/vouchers`); pass `vouchers={state.vouchers}` to `Register` and `details={state.companyDetails}` to `Header`.

`components/header.tsx`:
- Props gain `details: CompanyDetails`.
- Add a link next to the buttons: `<Link href="/vouchers" className="btn">Vouchers</Link>` (import `Link` from `next/link`).
- The edit form's draft becomes `{ names: CompanyNames; details: CompanyDetails } | null`. For each company show three inputs: name, address, TIN. `save` calls `PUT /api/companies` with the names and `PUT /api/company-details` with the details, then `onChanged()`.

- [ ] **Step 4: Typecheck, build, local check**

Run: `npm.cmd run typecheck` — expected: no errors. Run: `npm.cmd test` — expected: PASS. Build into `.next-check` — expected: "Compiled successfully" with `/vouchers` and `/vouchers/[id]`.

Start the dev server (log outside the project) and, signed in with `admin`:
1. Register: "Make voucher" on an issued cheque opens `/vouchers/<id>` with number `…-CV-0001`; on an Unassigned cheque the button is disabled.
2. The voucher page shows the cheque's details, the lines (empty locally unless invoices were synced), the preview with the amount in words. Add a line with gross "1,000", save, reload: the line is there. Type "abc" in a gross box, save: the line's error shows, nothing saved.
3. "Fill from sheet" on a cheque with no invoices says so.
4. Print preview (Ctrl+P in the browser): only the voucher sheet, on one A4 page.
5. `/vouchers` lists it; the search filters by payee and number. The register now says "Voucher" for that cheque, and the button opens the same voucher.
6. Edit names: add an address and TIN for one company; it appears at the top of its vouchers.
7. Delete the voucher: back at the list, it is gone; making a voucher for that cheque again gives `…-CV-0002`.
8. Phone width: no sideways scroll on the voucher page.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vouchers): voucher list and editor with print layout; Voucher button in the register; company addresses"
```

---

### Task 6: Docs, review and go-live

- [ ] **Step 1: README**

Add a "Check vouchers" section to `README.md`: what a voucher is, that it is made from a cheque in the register, the numbering, that lines come from the SI tabs once the updated script is installed, and that deleting is only possible while the cheque is unpaid. Mention `PUT /api/company-details` under settings and the new tables under migrations.

- [ ] **Step 2: Independent review**

Dispatch a fresh reviewer on the whole branch with the spec, the plan's Review Focus, and the ledger's `Ruling:` lines. Fix Critical and Important findings test-first; ledger the rest.

- [ ] **Step 3: Go live, in order**

1. `npm.cmd run migrate` against production — expected: `004_vouchers.sql`.
2. Merge to `main` and push; wait for the Vercel deploy; confirm `GET /login` is 200 and `GET /api/vouchers` without a session is 401.
3. Ask the owner to paste the new `sheet-script/Code.gs` into the sheet's Apps Script and save, then run "Check against the tracker (no changes)" and report the box. Then confirm from the database that `invoices` has rows after the next real sync.
4. Ask the owner to enter each company's address and TIN under Edit names.
5. Ask the owner to make one voucher and print it, and say how it looks.
