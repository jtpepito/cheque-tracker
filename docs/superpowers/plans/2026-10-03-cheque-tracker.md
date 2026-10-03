# Cheque Funding Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted, password-protected web app that shows how much will clear from each company's bank account on each of the next 14 days, with a cheque register, carrying over the cheques from the existing claude.ai page.

**Architecture:** One Next.js 15 app. Pure logic (dates, money, rules, validation, calendar, register) lives in small `lib/` modules with unit tests. A `node:sqlite` file on a Fly.io volume holds the data; JSON routes under `app/api/` read and write it; one client page polls `/api/state` every 30 seconds. Auth is a single shared password and an HMAC-signed cookie, copied from the HRIS app.

**Tech Stack:** Next.js 15.5.27, React 19.1.0, TypeScript, Tailwind CSS 4, `node:sqlite` (Node ≥ 22.5; Node 24 in Docker), `geist` fonts, Vitest 3, Fly.io.

**Spec:** `docs/superpowers/specs/2026-10-03-cheque-tracker-design.md` (source spec for v1 behaviour: `C:\Users\jffry\Downloads\spec-cheque tracker.md`)

## Global Constraints

- Project folder: `C:\WWJ\Claude Coding\Cheques`. All paths below are relative to it.
- On this PC use `npm.cmd` and `npx.cmd`, never `npm` / `npx` (PowerShell blocks the `.ps1` shims).
- Companies: `wwj`, `wythlae`, `wwjcorp`, `unassigned`. Statuses: `pending`, `issued`, `cleared`, `voided`.
- Default company names: `{ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" }`. `unassigned` always displays as "Unassigned".
- Only `issued` cheques count in the calendar and in the "Issued, not yet cleared" summary.
- Allowed status moves: `pending → issued`, `issued → cleared`, `issued → voided`. Nothing else.
- "Today" is the Manila date (`Asia/Manila`) everywhere. The server sends it to the page; the page never uses the browser's date.
- Money is summed in centavos (`Math.round(amount * 100)`) and divided back, never by adding floats.
- Exact copy: "Fund the bank account before these clear: …", "Nothing clearing in the next 2 days.", "Issued, not yet cleared: ₱X across N cheques.", "Hide cleared & voided".
- Real payees and amounts never enter git. `data/` is git-ignored. Tests use made-up data.
- No Google Fonts. Fonts come from the `geist` package.
- Dev server port 3002 (3000 and 3001 belong to the HRIS).
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Imported cheques with no amount (2 rows).** Totals treat them as 0 and the register shows "—"; nothing renders `NaN`. Test in Task 1 (`sumAmounts`) and Task 3 (calendar).
2. **Amounts typed the way people type them** ("12,500.50", "₱ 1,000"). Accepted and stored as a number rounded to centavos; "abc", "0" and "-5" are rejected. Test in Task 1 (`parseAmount`) and Task 2.
3. **Two people act on the same cheque, or one person double-clicks.** The second "Mark cleared" gets a clear message ("This cheque is already cleared.") and the page refreshes; a double-submitted new cheque is rejected as a duplicate (same company and cheque no., not voided). Tests in Task 4.
4. **Cheque numbers are text.** `WWJ682068`, `653507` and `0012` sort in natural order (numeric-aware), and leading zeros survive. Test in Task 3.
5. **Impossible or malformed input to the API** (cheque date `2026-02-30`, unknown company or status, body that isn't JSON). Rejected with 400 and a message; nothing is saved. Tests in Task 1 (`isValidDate`) and Task 2; route handling in Task 6.

Known and deliberately not handled: an `issued` cheque whose date has passed does not appear in the calendar, which starts today (source spec open item 2).

## File Structure

| File | Responsibility |
|---|---|
| `lib/types.ts` | `Company`, `Status`, `Cheque`, `CompanyNames`, guards, `companyLabel` |
| `lib/dates.ts` | `todayManila`, `addDays`, `isValidDate`, `shortDate` |
| `lib/money.ts` | `sumAmounts`, `parseAmount`, `peso` |
| `lib/rules.ts` | Status transition rules |
| `lib/validate.ts` | New cheque validation |
| `lib/calendar.ts` | 14-day totals and the 2-day alert list |
| `lib/register.ts` | Filter, sort and summaries for the register |
| `lib/db.ts` | Open the database, schema, singleton |
| `lib/backup.ts` | Daily backup, keep 30 |
| `lib/cheques.ts` | All reads and writes of cheques and company names; `importCheques` |
| `lib/import.ts` | `importIfPresent`: load `cheques-import.json` at startup |
| `lib/session.ts`, `lib/auth.ts`, `lib/http.ts` | Cookie signing, session checks, route helpers |
| `middleware.ts`, `instrumentation.ts` | Gate every request; open the database at boot |
| `app/login/*` | Sign-in page |
| `app/api/state`, `app/api/cheques`, `app/api/cheques/[id]`, `app/api/companies` | JSON routes |
| `lib/api.ts` | Browser fetch helper |
| `components/tracker.tsx`, `header.tsx`, `funding-calendar.tsx`, `register.tsx`, `cheque-form.tsx` | The page |
| `Dockerfile`, `fly.toml`, `README.md` | Deploying |

---

### Task 1: Scaffold the project; dates and money helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `tests/server-only-stub.ts`, `.env.development`, `.env.example`, `public/.gitkeep`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Modify: `.gitignore`
- Create: `lib/types.ts`, `lib/dates.ts`, `lib/money.ts`
- Test: `tests/dates.test.ts`, `tests/money.test.ts`

**Interfaces:**
- Produces: everything exported from `lib/types.ts`, `lib/dates.ts`, `lib/money.ts` as written below.

- [ ] **Step 1: Write the config files**

`package.json`:
```json
{
  "name": "cheque-tracker",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "geist": "^1.7.2",
    "next": "15.5.27",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^24.19.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^3.2.7"
  },
  "engines": { "node": ">=22.5" }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next-dev/types/**/*.ts", "next-env.d.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server builds into its own folder so it can run next to a local production build.
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // The Docker image (Fly.io) uses Next's self-contained server.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
```

`postcss.config.mjs`:
```js
const config = { plugins: ["@tailwindcss/postcss"] };
export default config;
```

`vitest.config.ts`:
```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
```

`tests/server-only-stub.ts`:
```ts
export {};
```

`.env.development`:
```
# Development defaults so `npm.cmd run dev` works on a fresh clone.
ADMIN_PASSWORD=admin
```

`.env.example`:
```
# Required in production: the single shared password.
ADMIN_PASSWORD=change-me
# Key for signing session cookies. Defaults to ADMIN_PASSWORD.
SESSION_SECRET=
# Where the SQLite file lives. Defaults to ./data/cheques.db
CHEQUES_DB_PATH=
```

`.gitignore` (replace the whole file):
```
node_modules/
.next/
.next-dev/
next-env.d.ts
*.tsbuildinfo
data/
.env*
!.env.development
!.env.example
```

`public/.gitkeep`: empty file (the Dockerfile copies `public/`).

- [ ] **Step 2: Write the app shell**

`app/globals.css`:
```css
@import "tailwindcss";

:root {
  --bg: #f1faf5;
  --card: #ffffff;
  --ink: #1f1b2e;
  --muted: #5f5a72;
  --line: #cfe8dc;
  --accent: #6d3fc4;
  --accent-ink: #ffffff;
  --mint: #bfead5;
  --warn: #fff3d6;
  --warn-ink: #7a4b00;
  --danger: #b3261e;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14121c;
    --card: #1e1b2b;
    --ink: #ece9f7;
    --muted: #a8a2c0;
    --line: #33304a;
    --accent: #b79cff;
    --accent-ink: #1b1330;
    --mint: #1f4a3a;
    --warn: #4a3610;
    --warn-ink: #ffd98a;
    --danger: #ff8a80;
  }
}

:root[data-theme="dark"] {
  --bg: #14121c;
  --card: #1e1b2b;
  --ink: #ece9f7;
  --muted: #a8a2c0;
  --line: #33304a;
  --accent: #b79cff;
  --accent-ink: #1b1330;
  --mint: #1f4a3a;
  --warn: #4a3610;
  --warn-ink: #ffd98a;
  --danger: #ff8a80;
}

@theme inline {
  --color-bg: var(--bg);
  --color-card: var(--card);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-mint: var(--mint);
  --color-warn: var(--warn);
  --color-warn-ink: var(--warn-ink);
  --color-danger: var(--danger);
  --font-sans: var(--font-geist-sans), "Segoe UI", system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, Consolas, monospace;
}

body {
  background: var(--bg);
  color: var(--ink);
}

input,
select,
button {
  font: inherit;
}

.field {
  @apply h-10 w-full rounded-md border border-line bg-card px-3 text-ink;
}

.btn {
  @apply inline-flex h-9 items-center justify-center rounded-md border border-line bg-card px-3 text-sm font-medium text-ink disabled:opacity-50;
}

.btn-primary {
  @apply border-accent bg-accent text-accent-ink;
}
```

`app/layout.tsx`:
```tsx
import type { Metadata } from "next";
// Self-hosted from the geist package: Google Fonts fails behind the office HTTPS inspection.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cheque Funding Tracker",
  description: "How much will clear, from which company, on each of the next few days.",
};

// Applies a saved light/dark choice before the first paint.
const themeScript =
  "try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-PH" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

`app/page.tsx` (replaced in Task 8):
```tsx
export default function Page() {
  return <main className="p-6">Cheque Funding Tracker</main>;
}
```

- [ ] **Step 3: Install**

Run: `npm.cmd install`
Expected: finishes without errors and writes `package-lock.json`.

- [ ] **Step 4: Write `lib/types.ts`**

```ts
export const COMPANIES = ["wwj", "wythlae", "wwjcorp", "unassigned"] as const;
export type Company = (typeof COMPANIES)[number];

export const STATUSES = ["pending", "issued", "cleared", "voided"] as const;
export type Status = (typeof STATUSES)[number];

export type Cheque = {
  id: string;
  company: Company;
  chequeNo: string;
  payee: string;
  /** PHP. Null only on two imported rows that have no amount in the source sheet. */
  amount: number | null;
  /** The cheque date, YYYY-MM-DD. Drives the calendar. */
  issueDate: string;
  /** The date logged in the sheet. Imported rows only. */
  encodedDate: string | null;
  bankAccount: string;
  particulars: string;
  status: Status;
  createdAt: number;
  imported: boolean;
  companyBasis: string | null;
  sourceRow: number | null;
};

export type CompanyNames = Record<Exclude<Company, "unassigned">, string>;

export const DEFAULT_COMPANY_NAMES: CompanyNames = {
  wwj: "WWJ Trading",
  wythlae: "Wythlae 1220",
  wwjcorp: "WWJ Corp",
};

export function isCompany(v: unknown): v is Company {
  return typeof v === "string" && (COMPANIES as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export function companyLabel(names: CompanyNames, company: Company): string {
  return company === "unassigned" ? "Unassigned" : names[company];
}
```

- [ ] **Step 5: Write the failing tests**

`tests/dates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addDays, isValidDate, shortDate, todayManila } from "@/lib/dates";

describe("todayManila", () => {
  it("uses the Manila date, not UTC", () => {
    // 3 Oct 2026 17:30 UTC is already 4 Oct, 1:30 AM in Manila.
    expect(todayManila(new Date("2026-10-03T17:30:00Z"))).toBe("2026-10-04");
    expect(todayManila(new Date("2026-10-03T15:59:00Z"))).toBe("2026-10-03");
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-03", 0)).toBe("2026-10-03");
  });
});

describe("isValidDate", () => {
  it("accepts real dates and rejects impossible or malformed ones", () => {
    expect(isValidDate("2026-10-03")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("3/10/2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
    expect(isValidDate(20261003)).toBe(false);
  });
});

describe("shortDate", () => {
  it("formats as weekday, day, month", () => {
    expect(shortDate("2026-10-03")).toBe("Sat, 3 Oct");
  });
});
```

`tests/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseAmount, peso, sumAmounts } from "@/lib/money";

describe("sumAmounts", () => {
  it("adds in centavos so floats don't drift", () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([1000.55, 2000.45, 0.01])).toBe(3001.01);
  });
  it("treats a missing amount as zero", () => {
    expect(sumAmounts([100, null, 50])).toBe(150);
    expect(sumAmounts([])).toBe(0);
  });
});

describe("parseAmount", () => {
  it("accepts numbers and typed strings with commas or a peso sign", () => {
    expect(parseAmount(1500)).toBe(1500);
    expect(parseAmount("12,500.50")).toBe(12500.5);
    expect(parseAmount("₱ 1,000")).toBe(1000);
    expect(parseAmount("10.006")).toBe(10.01);
  });
  it("rejects anything that is not a positive amount", () => {
    for (const bad of ["abc", "", "0", "-5", 0, -1, null, undefined, Number.NaN, "1.2.3"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("peso", () => {
  it("formats with a peso sign, commas and two decimals", () => {
    expect(peso(43403796.08)).toBe("₱43,403,796.08");
    expect(peso(0)).toBe("₱0.00");
  });
});
```

- [ ] **Step 6: Run the tests to see them fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/dates` and `@/lib/money`.

- [ ] **Step 7: Write `lib/dates.ts` and `lib/money.ts`**

`lib/dates.ts`:
```ts
/** Today's date in Manila as YYYY-MM-DD. */
export function todayManila(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** "Sat, 3 Oct" */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd}, ${dm}`;
}
```

`lib/money.ts`:
```ts
/** Sum of PHP amounts, added in centavos. A missing amount counts as zero. */
export function sumAmounts(amounts: Array<number | null>): number {
  let centavos = 0;
  for (const a of amounts) centavos += Math.round((a ?? 0) * 100);
  return centavos / 100;
}

/** A positive amount rounded to centavos, or null. Accepts "12,500.50" and "₱ 1,000". */
export function parseAmount(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const s = raw.replace(/[₱,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? rounded : null;
}

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm.cmd test`
Expected: PASS, 2 files.
Run: `npm.cmd run typecheck`
Expected: no errors. (If `next-env.d.ts` is missing, run `npm.cmd run build` once first; it creates it.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with dates and money helpers"
```

---

### Task 2: Status rules and new-cheque validation

**Files:**
- Create: `lib/rules.ts`, `lib/validate.ts`
- Test: `tests/rules.test.ts`, `tests/validate.test.ts`

**Interfaces:**
- Consumes: `Company`, `Status`, `isCompany` from `lib/types.ts`; `isValidDate` from `lib/dates.ts`; `parseAmount` from `lib/money.ts`.
- Produces:
  - `canTransition(from: Status, to: Status): boolean`
  - `nextStatuses(from: Status): Status[]`
  - `type NewChequeInput = { company: Company; chequeNo: string; payee: string; amount: number; issueDate: string; bankAccount: string; particulars: string; status: "issued" | "pending" }`
  - `type Validation = { ok: true; value: NewChequeInput } | { ok: false; errors: Record<string, string> }`
  - `validateNewCheque(raw: Record<string, unknown>): Validation`

- [ ] **Step 1: Write the failing tests**

`tests/rules.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "@/lib/rules";
import { STATUSES } from "@/lib/types";

describe("status rules", () => {
  it("allows only the three moves in the spec", () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(["issued>cleared", "issued>voided", "pending>issued"]);
  });
  it("lists the next statuses for the row buttons", () => {
    expect(nextStatuses("pending")).toEqual(["issued"]);
    expect(nextStatuses("issued")).toEqual(["cleared", "voided"]);
    expect(nextStatuses("cleared")).toEqual([]);
    expect(nextStatuses("voided")).toEqual([]);
  });
});
```

`tests/validate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validateNewCheque } from "@/lib/validate";

const good = {
  company: "wwj",
  chequeNo: " 0012 ",
  payee: " Sample Flour Supply ",
  amount: "12,500.50",
  issueDate: "2026-10-05",
  bankAccount: " BDO Current 1234 ",
  particulars: "SI 1001",
  status: "issued",
};

describe("validateNewCheque", () => {
  it("accepts a complete cheque and trims text", () => {
    const r = validateNewCheque(good);
    expect(r).toEqual({
      ok: true,
      value: {
        company: "wwj",
        chequeNo: "0012",
        payee: "Sample Flour Supply",
        amount: 12500.5,
        issueDate: "2026-10-05",
        bankAccount: "BDO Current 1234",
        particulars: "SI 1001",
        status: "issued",
      },
    });
  });

  it("lets bank account and particulars be blank and status default to issued", () => {
    const r = validateNewCheque({ ...good, bankAccount: undefined, particulars: "", status: undefined });
    expect(r.ok && r.value.bankAccount).toBe("");
    expect(r.ok && r.value.status).toBe("issued");
  });

  it("reports every missing or bad field", () => {
    const r = validateNewCheque({ company: "acme", chequeNo: " ", payee: "", amount: "0", issueDate: "2026-02-30", status: "cleared" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["amount", "chequeNo", "company", "issueDate", "payee", "status"]);
      expect(r.errors.amount).toBe("Enter an amount above zero.");
    }
  });

  it("rejects non-text values without throwing", () => {
    const r = validateNewCheque({ ...good, chequeNo: 12, payee: null });
    expect(r.ok).toBe(false);
  });

  it("rejects text that is too long", () => {
    const r = validateNewCheque({ ...good, payee: "x".repeat(201) });
    expect(!r.ok && r.errors.payee).toBe("Keep this under 200 characters.");
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/rules` and `@/lib/validate`.

- [ ] **Step 3: Write the implementation**

`lib/rules.ts`:
```ts
import type { Status } from "./types";

const NEXT: Record<Status, Status[]> = {
  pending: ["issued"],
  issued: ["cleared", "voided"],
  cleared: [],
  voided: [],
};

export function nextStatuses(from: Status): Status[] {
  return NEXT[from];
}

export function canTransition(from: Status, to: Status): boolean {
  return NEXT[from].includes(to);
}
```

`lib/validate.ts`:
```ts
import { isValidDate } from "./dates";
import { parseAmount } from "./money";
import { isCompany, type Company } from "./types";

export type NewChequeInput = {
  company: Company;
  chequeNo: string;
  payee: string;
  amount: number;
  issueDate: string;
  bankAccount: string;
  particulars: string;
  status: "issued" | "pending";
};

export type Validation = { ok: true; value: NewChequeInput } | { ok: false; errors: Record<string, string> };

const MAX = 200;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateNewCheque(raw: Record<string, unknown>): Validation {
  const errors: Record<string, string> = {};
  const chequeNo = text(raw.chequeNo);
  const payee = text(raw.payee);
  const bankAccount = text(raw.bankAccount);
  const particulars = text(raw.particulars);
  const amount = parseAmount(raw.amount);
  const status = raw.status ?? "issued";

  if (!isCompany(raw.company)) errors.company = "Choose a company.";
  if (!chequeNo) errors.chequeNo = "Enter the cheque no.";
  if (!payee) errors.payee = "Enter the payee.";
  if (amount === null) errors.amount = "Enter an amount above zero.";
  if (!isValidDate(raw.issueDate)) errors.issueDate = "Enter a valid cheque date.";
  if (status !== "issued" && status !== "pending") errors.status = "Choose issued or pending.";
  for (const [key, value] of Object.entries({ chequeNo, payee, bankAccount, particulars })) {
    if (value.length > MAX) errors[key] = `Keep this under ${MAX} characters.`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      company: raw.company as Company,
      chequeNo,
      payee,
      amount: amount!,
      issueDate: raw.issueDate as string,
      bankAccount,
      particulars,
      status: status as "issued" | "pending",
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm.cmd test`
Expected: PASS, 4 files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: status rules and new cheque validation"
```

---

### Task 3: Calendar and register logic

**Files:**
- Create: `lib/calendar.ts`, `lib/register.ts`
- Test: `tests/calendar.test.ts`, `tests/register.test.ts`

**Interfaces:**
- Consumes: `Cheque`, `Company`, `Status`, `COMPANIES` from `lib/types.ts`; `addDays` from `lib/dates.ts`; `sumAmounts` from `lib/money.ts`.
- Produces:
  - `type DayTotal = { date: string; total: number; count: number; byCompany: Record<Company, number>; soon: boolean }`
  - `buildCalendar(cheques: Cheque[], today: string, days?: number): DayTotal[]` (default 14)
  - `dueSoon(days: DayTotal[]): DayTotal[]`
  - `type Filters = { company: Company | "all"; status: Status | "all"; hideSettled: boolean }`
  - `DEFAULT_FILTERS: Filters`
  - `filterAndSort(cheques: Cheque[], filters: Filters): Cheque[]`
  - `issuedSummary(cheques: Cheque[]): { total: number; count: number }`
  - `unassignedSummary(cheques: Cheque[]): { total: number; count: number }`

- [ ] **Step 1: Write the failing tests**

`tests/helpers.ts` (shared by later tests):
```ts
import type { Cheque } from "@/lib/types";

let n = 0;
/** A made-up cheque. Never use real payees or amounts in tests. */
export function cheque(over: Partial<Cheque> = {}): Cheque {
  n += 1;
  return {
    id: `t-${n}`,
    company: "wwj",
    chequeNo: String(1000 + n),
    payee: "Sample Supplier",
    amount: 100,
    issueDate: "2026-10-03",
    encodedDate: null,
    bankAccount: "",
    particulars: "",
    status: "issued",
    createdAt: 0,
    imported: false,
    companyBasis: null,
    sourceRow: null,
    ...over,
  };
}
```

`tests/calendar.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildCalendar, dueSoon } from "@/lib/calendar";
import { cheque } from "./helpers";

const TODAY = "2026-10-03";

describe("buildCalendar", () => {
  it("returns 14 consecutive days starting today", () => {
    const days = buildCalendar([], TODAY);
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-10-03");
    expect(days[13].date).toBe("2026-10-16");
    expect(days.every((d) => d.total === 0 && d.count === 0)).toBe(true);
  });

  it("counts only issued cheques, on their cheque date, split by company", () => {
    const days = buildCalendar(
      [
        cheque({ issueDate: "2026-10-05", company: "wwj", amount: 1000.1 }),
        cheque({ issueDate: "2026-10-05", company: "wwj", amount: 2000.2 }),
        cheque({ issueDate: "2026-10-05", company: "unassigned", amount: 50 }),
        cheque({ issueDate: "2026-10-05", status: "pending", amount: 999 }),
        cheque({ issueDate: "2026-10-05", status: "cleared", amount: 999 }),
        cheque({ issueDate: "2026-10-05", status: "voided", amount: 999 }),
      ],
      TODAY,
    );
    const day = days[2];
    expect(day.total).toBe(3050.3);
    expect(day.count).toBe(3);
    expect(day.byCompany).toEqual({ wwj: 3000.3, wythlae: 0, wwjcorp: 0, unassigned: 50 });
  });

  it("ignores cheques dated before today or after the window", () => {
    const days = buildCalendar(
      [cheque({ issueDate: "2026-10-02" }), cheque({ issueDate: "2026-10-17" })],
      TODAY,
    );
    expect(days.every((d) => d.total === 0)).toBe(true);
  });

  it("counts a cheque with no amount but adds zero", () => {
    const days = buildCalendar([cheque({ amount: null }), cheque({ amount: 25 })], TODAY);
    expect(days[0].count).toBe(2);
    expect(days[0].total).toBe(25);
  });

  it("marks today through day +2 as soon", () => {
    const days = buildCalendar([], TODAY);
    expect(days.map((d) => d.soon)).toEqual([true, true, true, ...Array(11).fill(false)]);
  });
});

describe("dueSoon", () => {
  it("lists only soon days with money clearing", () => {
    const days = buildCalendar(
      [
        cheque({ issueDate: "2026-10-03", amount: 10 }),
        cheque({ issueDate: "2026-10-05", amount: 20 }),
        cheque({ issueDate: "2026-10-06", amount: 30 }),
      ],
      TODAY,
    );
    expect(dueSoon(days).map((d) => d.date)).toEqual(["2026-10-03", "2026-10-05"]);
  });
  it("is empty when nothing is clearing in the next 2 days", () => {
    expect(dueSoon(buildCalendar([cheque({ issueDate: "2026-10-06" })], TODAY))).toEqual([]);
  });
});
```

`tests/register.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filterAndSort, issuedSummary, unassignedSummary } from "@/lib/register";
import { cheque } from "./helpers";

describe("filterAndSort", () => {
  it("hides cleared and voided by default", () => {
    const list = [
      cheque({ status: "issued" }),
      cheque({ status: "pending" }),
      cheque({ status: "cleared" }),
      cheque({ status: "voided" }),
    ];
    expect(filterAndSort(list, DEFAULT_FILTERS).map((c) => c.status)).toEqual(["issued", "pending"]);
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, hideSettled: false })).toHaveLength(4);
  });

  it("filters by company and status", () => {
    const list = [
      cheque({ company: "wwj" }),
      cheque({ company: "wythlae" }),
      cheque({ company: "wythlae", status: "pending" }),
    ];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, company: "wythlae" })).toHaveLength(2);
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, company: "wythlae", status: "pending" })).toHaveLength(1);
  });

  it("shows a chosen settled status even when hide is on", () => {
    const list = [cheque({ status: "cleared" }), cheque({ status: "issued" })];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, status: "cleared" })).toHaveLength(1);
  });

  it("sorts by cheque date, then cheque no. in natural order", () => {
    const list = [
      cheque({ issueDate: "2026-10-05", chequeNo: "653507" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "WWJ682068" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "100" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "99" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "0012" }),
    ];
    expect(filterAndSort(list, DEFAULT_FILTERS).map((c) => c.chequeNo)).toEqual([
      "0012",
      "99",
      "100",
      "WWJ682068",
      "653507",
    ]);
  });

  it("does not change the list it was given", () => {
    const list = [cheque({ issueDate: "2026-10-05" }), cheque({ issueDate: "2026-10-04" })];
    const before = list.map((c) => c.id);
    filterAndSort(list, DEFAULT_FILTERS);
    expect(list.map((c) => c.id)).toEqual(before);
  });
});

describe("summaries", () => {
  it("totals issued cheques only", () => {
    const list = [
      cheque({ amount: 100.1 }),
      cheque({ amount: 200.2 }),
      cheque({ amount: null }),
      cheque({ amount: 500, status: "pending" }),
      cheque({ amount: 500, status: "cleared" }),
    ];
    expect(issuedSummary(list)).toEqual({ total: 300.3, count: 3 });
  });

  it("totals unassigned cheques that are still pending or issued", () => {
    const list = [
      cheque({ company: "unassigned", amount: 10 }),
      cheque({ company: "unassigned", amount: 20, status: "pending" }),
      cheque({ company: "unassigned", amount: 40, status: "cleared" }),
      cheque({ company: "wwj", amount: 80 }),
    ];
    expect(unassignedSummary(list)).toEqual({ total: 30, count: 2 });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/calendar` and `@/lib/register`.

- [ ] **Step 3: Write the implementation**

`lib/calendar.ts`:
```ts
import { addDays } from "./dates";
import { sumAmounts } from "./money";
import { COMPANIES, type Cheque, type Company } from "./types";

export type DayTotal = {
  date: string;
  total: number;
  count: number;
  byCompany: Record<Company, number>;
  /** Today through day +2. */
  soon: boolean;
};

/** Totals of issued cheques per cheque date for `days` days starting today. */
export function buildCalendar(cheques: Cheque[], today: string, days = 14): DayTotal[] {
  const issued = cheques.filter((c) => c.status === "issued");
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    const onDay = issued.filter((c) => c.issueDate === date);
    const byCompany = Object.fromEntries(
      COMPANIES.map((co) => [co, sumAmounts(onDay.filter((c) => c.company === co).map((c) => c.amount))]),
    ) as Record<Company, number>;
    return { date, total: sumAmounts(onDay.map((c) => c.amount)), count: onDay.length, byCompany, soon: i <= 2 };
  });
}

/** The days in the next 2 days that have money clearing. */
export function dueSoon(days: DayTotal[]): DayTotal[] {
  return days.filter((d) => d.soon && d.total > 0);
}
```

`lib/register.ts`:
```ts
import { sumAmounts } from "./money";
import type { Cheque, Company, Status } from "./types";

export type Filters = { company: Company | "all"; status: Status | "all"; hideSettled: boolean };

export const DEFAULT_FILTERS: Filters = { company: "all", status: "all", hideSettled: true };

const settled = (c: Cheque) => c.status === "cleared" || c.status === "voided";

export function filterAndSort(cheques: Cheque[], filters: Filters): Cheque[] {
  return cheques
    .filter((c) => filters.company === "all" || c.company === filters.company)
    .filter((c) => (filters.status === "all" ? !(filters.hideSettled && settled(c)) : c.status === filters.status))
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) || a.chequeNo.localeCompare(b.chequeNo, "en", { numeric: true }),
    );
}

function summary(list: Cheque[]) {
  return { total: sumAmounts(list.map((c) => c.amount)), count: list.length };
}

/** "Issued, not yet cleared: ₱X across N cheques." */
export function issuedSummary(cheques: Cheque[]) {
  return summary(cheques.filter((c) => c.status === "issued"));
}

/** Unassigned cheques still to be settled; these are the ones staff need to review. */
export function unassignedSummary(cheques: Cheque[]) {
  return summary(cheques.filter((c) => c.company === "unassigned" && !settled(c)));
}
```

Note: `.filter()` returns a new array, so the `.sort()` does not touch the caller's list.

- [ ] **Step 4: Run tests**

Run: `npm.cmd test`
Expected: PASS, 6 files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: funding calendar and register logic"
```

---

### Task 4: Database, cheque store, backups

**Files:**
- Create: `lib/db.ts`, `lib/backup.ts`, `lib/cheques.ts`, `instrumentation.ts`
- Test: `tests/cheques.test.ts`

**Interfaces:**
- Consumes: types from `lib/types.ts`; `NewChequeInput` from `lib/validate.ts`; `canTransition` from `lib/rules.ts`; `todayManila` from `lib/dates.ts`.
- Produces:
  - `dbFile(): string`, `openDatabase(file: string): DatabaseSync`, `getDb(): DatabaseSync`
  - `class ChequeError extends Error { code: "not_found" | "conflict" | "duplicate" }`
  - `listCheques(db): Cheque[]`
  - `createCheque(db, input: NewChequeInput, now?: number): Cheque`
  - `setStatus(db, id: string, to: Status): Cheque`
  - `setCompany(db, id: string, company: Company): Cheque`
  - `getCompanyNames(db): CompanyNames`
  - `setCompanyNames(db, names: CompanyNames): CompanyNames`
  - `upsertCheque(db, c: Cheque): void` (used by the import in Task 5)

`lib/db.ts` in this task does not call the import yet; Task 5 adds that line.

- [ ] **Step 1: Write the failing test**

`tests/cheques.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@/lib/db";
import {
  ChequeError,
  createCheque,
  getCompanyNames,
  listCheques,
  setCompany,
  setCompanyNames,
  setStatus,
} from "@/lib/cheques";
import type { NewChequeInput } from "@/lib/validate";

const input: NewChequeInput = {
  company: "wwj",
  chequeNo: "0012",
  payee: "Sample Flour Supply",
  amount: 12500.5,
  issueDate: "2026-10-05",
  bankAccount: "",
  particulars: "SI 1001",
  status: "pending",
};

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e instanceof ChequeError ? e.code : "other";
  }
  return "none";
}

describe("cheques store", () => {
  it("creates and lists a cheque with every field", () => {
    const c = createCheque(db, input, 1700000000000);
    expect(c).toMatchObject({ ...input, createdAt: 1700000000000, imported: false, encodedDate: null, sourceRow: null });
    expect(c.id).toMatch(/[0-9a-f-]{36}/);
    expect(listCheques(db)).toEqual([c]);
  });

  it("keeps leading zeros in the cheque no.", () => {
    expect(createCheque(db, input).chequeNo).toBe("0012");
  });

  it("rejects the same cheque no. twice for one company", () => {
    createCheque(db, input);
    expect(codeOf(() => createCheque(db, input))).toBe("duplicate");
    expect(listCheques(db)).toHaveLength(1);
    createCheque(db, { ...input, chequeNo: "WWJ1" });
    expect(codeOf(() => createCheque(db, { ...input, chequeNo: "wwj1" }))).toBe("duplicate");
  });

  it("allows the same cheque no. for another company, or after the first is voided", () => {
    const first = createCheque(db, { ...input, status: "issued" });
    createCheque(db, { ...input, company: "wythlae" });
    setStatus(db, first.id, "voided");
    createCheque(db, input);
    expect(listCheques(db)).toHaveLength(3);
  });

  it("moves pending to issued to cleared", () => {
    const c = createCheque(db, input);
    expect(setStatus(db, c.id, "issued").status).toBe("issued");
    expect(setStatus(db, c.id, "cleared").status).toBe("cleared");
  });

  it("refuses a move that is not allowed, with a message naming the current status", () => {
    const c = createCheque(db, { ...input, status: "issued" });
    setStatus(db, c.id, "cleared");
    try {
      setStatus(db, c.id, "cleared");
      expect.unreachable();
    } catch (e) {
      expect((e as ChequeError).code).toBe("conflict");
      expect((e as Error).message).toBe("This cheque is already cleared.");
    }
    expect(codeOf(() => setStatus(db, c.id, "issued"))).toBe("conflict");
  });

  it("reports an unknown id", () => {
    expect(codeOf(() => setStatus(db, "nope", "issued"))).toBe("not_found");
    expect(codeOf(() => setCompany(db, "nope", "wwj"))).toBe("not_found");
  });

  it("changes the company on any row", () => {
    const c = createCheque(db, { ...input, company: "unassigned", status: "issued" });
    setStatus(db, c.id, "cleared");
    expect(setCompany(db, c.id, "wwjcorp").company).toBe("wwjcorp");
  });

  it("starts with the default company names and saves new ones", () => {
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
    setCompanyNames(db, { wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/db` and `@/lib/cheques`.

- [ ] **Step 3: Write the implementation**

`lib/backup.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { todayManila } from "./dates";

// Daily copies of the database in a "backups" folder next to it. Each copy is a complete,
// standalone SQLite file (VACUUM INTO), safe to take while the app is running.

export const KEEP_BACKUPS = 30;
const NAME = /^cheques-\d{4}-\d{2}-\d{2}\.db$/;

/** Writes today's backup unless it exists, then removes copies beyond KEEP_BACKUPS. */
export function createBackup(db: DatabaseSync, dbFile: string): string | null {
  const dir = path.join(path.dirname(dbFile), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const name = `cheques-${todayManila()}.db`;
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return null;
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const old = fs.readdirSync(dir).filter((n) => NAME.test(n)).sort().reverse().slice(KEEP_BACKUPS);
  for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
  return name;
}

const globalForBackup = globalThis as unknown as { __chequesBackupTimer?: NodeJS.Timeout };

/** Makes today's backup now if missing, then checks again every hour. */
export function scheduleDailyBackups(db: DatabaseSync, dbFile: string) {
  if (globalForBackup.__chequesBackupTimer) return;
  const run = () => {
    try {
      createBackup(db, dbFile);
    } catch (err) {
      console.error("[backup] failed:", err);
    }
  };
  run();
  globalForBackup.__chequesBackupTimer = setInterval(run, 60 * 60 * 1000);
  globalForBackup.__chequesBackupTimer.unref?.();
}
```

`lib/db.ts`:
```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scheduleDailyBackups } from "./backup";
import { DEFAULT_COMPANY_NAMES } from "./types";

// One SQLite connection per server process. Kept on globalThis so dev-mode hot reloads
// reuse it instead of opening a new handle on every edit.
const globalForDb = globalThis as unknown as { __chequesDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cheques (
  id            TEXT PRIMARY KEY,
  company       TEXT NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp','unassigned')),
  cheque_no     TEXT NOT NULL,
  payee         TEXT NOT NULL,
  amount        REAL,
  issue_date    TEXT NOT NULL,
  encoded_date  TEXT,
  bank_account  TEXT NOT NULL DEFAULT '',
  particulars   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('pending','issued','cleared','voided')),
  created_at    INTEGER NOT NULL,
  imported      INTEGER NOT NULL DEFAULT 0,
  company_basis TEXT,
  source_row    INTEGER
);
CREATE INDEX IF NOT EXISTS cheques_issue_date ON cheques(issue_date);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function dbFile(): string {
  return process.env.CHEQUES_DB_PATH || path.join(process.cwd(), "data", "cheques.db");
}

export function openDatabase(file: string): DatabaseSync {
  const onDisk = file !== ":memory:";
  if (onDisk) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (onDisk) db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('companies', ?)").run(
    JSON.stringify(DEFAULT_COMPANY_NAMES),
  );
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__chequesDb) {
    const file = dbFile();
    const db = openDatabase(file);
    globalForDb.__chequesDb = db;
    scheduleDailyBackups(db, file);
  }
  return globalForDb.__chequesDb;
}
```

`lib/cheques.ts`:
```ts
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
```

`instrumentation.ts`:
```ts
// Runs once when the server starts. Opening the database here creates the tables, loads a
// waiting import file and starts the daily backups, instead of waiting for the first sign-in.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    getDb();
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm.cmd test`
Expected: PASS, 7 files.
Run: `npm.cmd run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SQLite store for cheques and company names, daily backups"
```

---

### Task 5: Import at startup, and the export from the live page

**Files:**
- Create: `lib/import.ts`
- Modify: `lib/db.ts` (`getDb`)
- Test: `tests/import.test.ts`
- Create (git-ignored, real data): `data/cheques-import.json`

**Interfaces:**
- Consumes: `upsertCheque`, `setCompanyNames`, `getCompanyNames`, `listCheques` from `lib/cheques.ts`; `isValidDate`; `sumAmounts`, `peso`; type guards.
- Produces:
  - `type ImportFile = { companies?: Partial<CompanyNames>; cheques: Array<Record<string, unknown>> }`
  - `importCheques(db, file: ImportFile): { count: number; summary: string }`
  - `importIfPresent(db, jsonPath: string): { count: number; summary: string } | null` — imports the file, then renames it to `<name>.imported-<YYYY-MM-DD>.json`.

Import file format (field names are the ones in the source spec §5):
```json
{
  "companies": { "wwj": "WWJ Trading", "wythlae": "Wythlae 1220", "wwjcorp": "WWJ Corp" },
  "cheques": [
    { "id": "imp-2", "company": "wwj", "chequeNo": "WWJ000001", "payee": "Sample Supplier", "amount": 100,
      "issueDate": "2026-10-05", "encodedDate": "2026-09-28", "bankAccount": "", "particulars": "SI 1",
      "status": "issued", "createdAt": 1759449600000, "imported": true, "companyBasis": "chequeNo", "sourceRow": 2 }
  ]
}
```

- [ ] **Step 1: Write the failing test**

`tests/import.test.ts`:
```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createCheque, getCompanyNames, listCheques, setCompany } from "@/lib/cheques";
import { openDatabase } from "@/lib/db";
import { importCheques, importIfPresent, type ImportFile } from "@/lib/import";

const row = (over: Record<string, unknown> = {}) => ({
  id: "imp-2",
  company: "wwj",
  chequeNo: "WWJ000001",
  payee: "Sample Supplier",
  amount: 100.5,
  issueDate: "2026-10-05",
  encodedDate: "2026-09-28",
  bankAccount: "",
  particulars: "SI 1",
  status: "issued",
  createdAt: 1759449600000,
  imported: true,
  companyBasis: "chequeNo",
  sourceRow: 2,
  ...over,
});

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("importCheques", () => {
  it("loads rows with every field", () => {
    const r = importCheques(db, { cheques: [row()] });
    expect(r.count).toBe(1);
    expect(listCheques(db)[0]).toEqual(row());
  });

  it("can be run twice without duplicating rows, and the file wins", () => {
    const file: ImportFile = { cheques: [row(), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] };
    importCheques(db, file);
    setCompany(db, "imp-2", "wythlae");
    importCheques(db, file);
    const all = listCheques(db);
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id === "imp-2")!.company).toBe("wwj");
  });

  it("leaves cheques that are not in the file alone", () => {
    createCheque(db, {
      company: "wwj", chequeNo: "9", payee: "Other", amount: 1, issueDate: "2026-10-06",
      bankAccount: "", particulars: "", status: "issued",
    });
    importCheques(db, { cheques: [row()] });
    expect(listCheques(db)).toHaveLength(2);
  });

  it("keeps a blank amount as null and a numeric cheque no. as text", () => {
    importCheques(db, { cheques: [row({ amount: null, chequeNo: 657516 }), row({ id: "imp-4", amount: "" })] });
    const all = listCheques(db);
    expect(all.find((c) => c.id === "imp-2")).toMatchObject({ amount: null, chequeNo: "657516" });
    expect(all.find((c) => c.id === "imp-4")!.amount).toBeNull();
  });

  it("fills optional fields that are missing", () => {
    importCheques(db, { cheques: [{ id: "x1", company: "wwj", chequeNo: "1", payee: "P", amount: 5, issueDate: "2026-10-05", status: "issued" }] });
    expect(listCheques(db)[0]).toMatchObject({ bankAccount: "", particulars: "", encodedDate: null, imported: false, sourceRow: null });
  });

  it("stops and saves nothing when a row is unusable", () => {
    const bad = [row(), row({ id: "imp-9", issueDate: "05/10/2026" })];
    expect(() => importCheques(db, { cheques: bad })).toThrow(/imp-9.*cheque date/);
    expect(listCheques(db)).toHaveLength(0);
    expect(() => importCheques(db, { cheques: [row({ company: "acme" })] })).toThrow(/company/);
    expect(() => importCheques(db, { cheques: [row({ status: "lost" })] })).toThrow(/status/);
    expect(() => importCheques(db, { cheques: [row({ id: "" })] })).toThrow(/id/);
  });

  it("applies company names from the file", () => {
    importCheques(db, { companies: { wwj: "WWJ Renamed" }, cheques: [] });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Renamed", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
  });

  it("summarises the whole register by company", () => {
    const r = importCheques(db, {
      cheques: [row(), row({ id: "imp-3", company: "unassigned", amount: 200 }), row({ id: "imp-4", amount: null })],
    });
    expect(r.summary).toBe(
      "[import] 3 cheques, ₱300.50 | wwj 2 ₱100.50 | wythlae 0 ₱0.00 | wwjcorp 0 ₱0.00 | unassigned 1 ₱200.00",
    );
  });
});

describe("importIfPresent", () => {
  it("does nothing when there is no file", () => {
    expect(importIfPresent(db, path.join(os.tmpdir(), "no-such-cheques-import.json"))).toBeNull();
  });

  it("imports the file once and renames it so it is not loaded again", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheques-"));
    const file = path.join(dir, "cheques-import.json");
    fs.writeFileSync(file, JSON.stringify({ cheques: [row()] }));
    expect(importIfPresent(db, file)!.count).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir).some((n) => /^cheques-import\.imported-\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true);
    expect(importIfPresent(db, file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/import`.

- [ ] **Step 3: Write `lib/import.ts`**

```ts
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
```

Note on the summary test: with one cheque the label reads "1 cheque"; the test above has 3, so it reads "3 cheques".

- [ ] **Step 4: Call the import from `getDb`**

In `lib/db.ts`, add the import at the top:
```ts
import { importIfPresent } from "./import";
```
and replace `getDb` with:
```ts
export function getDb(): DatabaseSync {
  if (!globalForDb.__chequesDb) {
    const file = dbFile();
    const db = openDatabase(file);
    globalForDb.__chequesDb = db;
    scheduleDailyBackups(db, file);
    // A file placed next to the database is loaded once at startup (see README, "Loading cheques").
    try {
      const result = importIfPresent(db, path.join(path.dirname(file), "cheques-import.json"));
      if (result) console.log(result.summary);
    } catch (err) {
      console.error("[import] failed, nothing was loaded:", err);
    }
  }
  return globalForDb.__chequesDb;
}
```
The backup runs first, so there is always a copy from before an import.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm.cmd test`
Expected: PASS, 8 files.
Run: `npm.cmd run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: load a cheques import file at startup"
```

- [ ] **Step 7: Export the live data (real data; not committed)**

Use the `ArtifactData` tool (load it with ToolSearch `select:ArtifactData`) against `https://claude.ai/artifact/LP8BmmaYeKPAwYT5vSipWS`:
1. `get` collection `config`, doc `companies`.
2. `list` collection `cheques`, following pages until there are no more.
3. Write `data/cheques-import.json` in the format above: `companies` from step 1; each cheque is the document's fields plus `"id"` set to the document id.

Then check the file:
```bash
node -e "const f=require('./data/cheques-import.json');console.log(f.cheques.length, f.cheques.filter(c=>String(c.id).startsWith('imp-')).length)"
```
Expected: the second number is 585 (imported rows); the first is 585 plus any cheques staff added by hand.

Run `git status --short` and confirm `data/` does not appear. If the tool cannot read the artifact, stop and report; do not invent data.

---

### Task 6: Sign-in, session and API routes

**Files:**
- Create: `lib/session.ts`, `lib/auth.ts`, `lib/http.ts`, `middleware.ts`
- Create: `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts`
- Create: `app/api/state/route.ts`, `app/api/cheques/route.ts`, `app/api/cheques/[id]/route.ts`, `app/api/companies/route.ts`
- Test: `tests/session.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces (HTTP, all JSON, all need the session cookie):
  - `GET /api/state` → `200 { today: string, companies: CompanyNames, cheques: Cheque[] }`
  - `POST /api/cheques` body = new cheque fields → `201 Cheque` | `400 { error, errors }` | `409 { error }`
  - `PATCH /api/cheques/:id` body `{ status }` or `{ company }` → `200 Cheque` | `400` | `404` | `409 { error }`
  - `PUT /api/companies` body `{ wwj, wythlae, wwjcorp }` → `200 CompanyNames` | `400 { error }`
  - No session: `401 { error }` for `/api/*` and for any non-GET; other pages redirect to `/login`.
  - `logout` server action exported from `app/login/actions.ts`.

- [ ] **Step 1: Write the failing test**

`tests/session.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPassword, createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";

const saved = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-secret";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("session", () => {
  it("accepts its own token and rejects a tampered or expired one", async () => {
    const now = 1_800_000_000_000;
    const token = await createSessionToken(now);
    expect(await verifySessionToken(token, now)).toBe(true);
    expect(await verifySessionToken(token + "0", now)).toBe(false);
    expect(await verifySessionToken(undefined, now)).toBe(false);
    expect(await verifySessionToken("garbage", now)).toBe(false);
    expect(await verifySessionToken(token, now + (SESSION_TTL_SECONDS + 1) * 1000)).toBe(false);
  });

  it("rejects tokens signed with another secret", async () => {
    const token = await createSessionToken();
    process.env.SESSION_SECRET = "other";
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("checks the password and never accepts an unset one", () => {
    expect(checkPassword("test-password")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
    delete process.env.ADMIN_PASSWORD;
    expect(checkPassword("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm.cmd test`
Expected: FAIL, cannot resolve `@/lib/session`.

- [ ] **Step 3: Write session, auth and middleware**

`lib/session.ts`:
```ts
// HMAC-signed session cookie. Uses Web Crypto so the same code runs in middleware (edge
// runtime) and in route handlers (Node).

// Browsers share cookies across localhost ports, so the dev server uses its own name.
export const SESSION_COOKIE = process.env.NODE_ENV === "development" ? "cheques_dev_session" : "cheques_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Cookie value: "<expiry-unix-seconds>.<hmac>". */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD is not set");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(key, `session:${exp}`)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp < now / 1000) return false;
  return safeEqual(sig, await hmac(key, `session:${exp}`));
}

export function checkPassword(attempt: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && safeEqual(attempt, expected);
}
```

`lib/auth.ts`:
```ts
import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** Re-checks the session inside route handlers. Middleware already gates every request. */
export async function isSignedIn(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Mark cookies Secure when the request came over HTTPS (Fly.io), not on plain-HTTP localhost. */
export async function cookieSecure(): Promise<boolean> {
  const h = await headers();
  return h.get("x-forwarded-proto") === "https" || (h.get("origin") ?? "").startsWith("https://");
}
```

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Every page and API route needs a valid session except /login.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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

- [ ] **Step 4: Write the sign-in page**

`app/login/actions.ts`:
```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieSecure } from "@/lib/auth";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  if (!process.env.ADMIN_PASSWORD) {
    return { error: "ADMIN_PASSWORD is not set on the server. Add it to the environment and restart." };
  }
  if (!checkPassword(String(fd.get("password") ?? ""))) {
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Wrong password." };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
```

`app/login/login-form.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={!!state.error || undefined}
          className="field"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary h-10 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

`app/login/page.tsx`:
```tsx
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Cheque Funding Tracker" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Cheque Funding Tracker</h1>
      <div className="rounded-xl border border-line bg-card p-5">
        <LoginForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Write the route helpers and routes**

`lib/http.ts`:
```ts
import "server-only";
import { NextResponse } from "next/server";
import { isSignedIn } from "./auth";
import { ChequeError } from "./cheques";

type Handler = () => Promise<NextResponse> | NextResponse;

/** Checks the session, runs the handler, and turns known errors into JSON responses. */
export async function guarded(handler: Handler): Promise<NextResponse> {
  if (!(await isSignedIn())) {
    return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }
  try {
    return await handler();
  } catch (err) {
    if (err instanceof ChequeError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "not_found" ? 404 : 409 });
    }
    console.error("[api] failed:", err);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export const badRequest = (error: string, errors?: Record<string, string>) =>
  NextResponse.json({ error, errors }, { status: 400 });

/** The request body as a plain object, or null when it is not a JSON object. */
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
```

`app/api/state/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getCompanyNames, listCheques } from "@/lib/cheques";
import { todayManila } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { guarded } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(() => {
    const db = getDb();
    return NextResponse.json(
      { today: todayManila(), companies: getCompanyNames(db), cheques: listCheques(db) },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
```

`app/api/cheques/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createCheque } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { validateNewCheque } from "@/lib/validate";

export function POST(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const v = validateNewCheque(body);
    if (!v.ok) return badRequest("Fix the highlighted fields.", v.errors);
    return NextResponse.json(createCheque(getDb(), v.value), { status: 201 });
  });
}
```

`app/api/cheques/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { setCompany, setStatus } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { isCompany, isStatus } from "@/lib/types";

export function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    if ("status" in body) {
      if (!isStatus(body.status)) return badRequest("Unknown status.");
      return NextResponse.json(setStatus(getDb(), id, body.status));
    }
    if ("company" in body) {
      if (!isCompany(body.company)) return badRequest("Unknown company.");
      return NextResponse.json(setCompany(getDb(), id, body.company));
    }
    return badRequest("Nothing to change.");
  });
}
```

`app/api/companies/route.ts`:
```ts
import { NextResponse } from "next/server";
import { setCompanyNames } from "@/lib/cheques";
import { getDb } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import type { CompanyNames } from "@/lib/types";

const KEYS = ["wwj", "wythlae", "wwjcorp"] as const;

export function PUT(req: Request) {
  return guarded(async () => {
    const body = await readObject(req);
    if (!body) return badRequest("The request was not understood.");
    const names = {} as CompanyNames;
    for (const key of KEYS) {
      const raw = body[key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value || value.length > 60) return badRequest("Each company needs a name of up to 60 characters.");
      names[key] = value;
    }
    return NextResponse.json(setCompanyNames(getDb(), names));
  });
}
```

- [ ] **Step 6: Run tests, typecheck, and try the routes**

Run: `npm.cmd test`
Expected: PASS, 9 files.
Run: `npm.cmd run typecheck`
Expected: no errors.

Start the dev server in the Terminal panel (background jobs get killed on this PC): `npm.cmd run dev`. It loads `data/cheques-import.json` from Task 5 on start; the server log prints the `[import]` summary line. Then, in PowerShell:
```powershell
(Invoke-WebRequest http://localhost:3002/api/state -SkipHttpErrorCheck -UseBasicParsing).StatusCode
```
Expected: `401`. (On Windows PowerShell 5.1, which lacks `-SkipHttpErrorCheck`, the command throws with "(401) Unauthorized"; that is the same result.)

Record the `[import]` summary line for the final report and compare it with the source spec §7 (585 cheques, ₱43,403,796.08; WWJ 247, Wythlae 82, WWJ Corp 1, Unassigned 255). Company counts may differ where staff have reassigned cheques since the import; the grand total of imported rows should not.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: sign-in, session cookie and JSON routes"
```

---

### Task 7: The tracker page

**Files:**
- Create: `lib/api.ts`, `components/tracker.tsx`, `components/header.tsx`, `components/funding-calendar.tsx`, `components/register.tsx`, `components/cheque-form.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: the HTTP routes from Task 6; `buildCalendar`, `dueSoon`, `DayTotal`; `filterAndSort`, `issuedSummary`, `unassignedSummary`, `DEFAULT_FILTERS`, `Filters`; `nextStatuses`; `peso`; `shortDate`; `companyLabel`, `COMPANIES`, `STATUSES`; `logout`.
- Produces: the finished page at `/`.

No unit tests in this task: the logic it renders is tested in Tasks 1–3, and the page is exercised in the browser in Step 8.

- [ ] **Step 1: Write `lib/api.ts`**

```ts
/** Browser-side fetch helper for the JSON routes. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check the connection and try again.", 0);
  }
  if (res.status === 401) {
    window.location.href = "/login";
    throw new ApiError("Session expired. Sign in again.", 401);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong. Try again.", res.status, data.errors);
  return data as T;
}
```

- [ ] **Step 2: Write `components/funding-calendar.tsx`**

```tsx
import { dueSoon, type DayTotal } from "@/lib/calendar";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { COMPANIES, companyLabel, type CompanyNames } from "@/lib/types";

function split(day: DayTotal, names: CompanyNames) {
  return COMPANIES.filter((co) => day.byCompany[co] > 0).map((co) => ({
    label: companyLabel(names, co),
    amount: day.byCompany[co],
  }));
}

export function FundingCalendar({ days, names }: { days: DayTotal[]; names: CompanyNames }) {
  const due = dueSoon(days);
  return (
    <section aria-labelledby="calendar-heading" className="space-y-3">
      <h2 id="calendar-heading" className="text-lg font-semibold">
        Next 14 days
      </h2>
      {due.length > 0 ? (
        <div role="status" className="rounded-lg bg-warn p-3 text-sm text-warn-ink">
          <p className="font-semibold">Fund the bank account before these clear:</p>
          <ul className="mt-1 space-y-0.5">
            {due.map((d, i) => (
              <li key={d.date}>
                {i === 0 && d.date === days[0].date ? "Today" : shortDate(d.date)}: {peso(d.total)} (
                {split(d, names)
                  .map((s) => `${s.label} ${peso(s.amount)}`)
                  .join(", ")}
                )
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p role="status" className="rounded-lg bg-mint p-3 text-sm">
          Nothing clearing in the next 2 days.
        </p>
      )}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d, i) => (
          <li
            key={d.date}
            className={`rounded-lg border p-3 ${
              d.soon && d.total > 0 ? "border-warn-ink bg-warn text-warn-ink" : "border-line bg-card"
            }`}
          >
            <p className="text-xs font-medium">{i === 0 ? "Today" : shortDate(d.date)}</p>
            <p className={`mt-1 font-mono text-sm font-semibold ${d.total === 0 ? "opacity-50" : ""}`}>
              {peso(d.total)}
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {split(d, names).map((s) => (
                <li key={s.label} className="flex flex-wrap justify-between gap-x-2">
                  <span>{s.label}</span>
                  <span className="font-mono">{peso(s.amount)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 3: Write `components/register.tsx`**

```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortDate } from "@/lib/dates";
import { peso } from "@/lib/money";
import { DEFAULT_FILTERS, filterAndSort, issuedSummary, unassignedSummary, type Filters } from "@/lib/register";
import { nextStatuses } from "@/lib/rules";
import { COMPANIES, STATUSES, companyLabel, type Cheque, type Company, type CompanyNames, type Status } from "@/lib/types";

const ACTION_LABEL: Record<Status, string> = {
  pending: "Mark pending",
  issued: "Mark issued",
  cleared: "Mark cleared",
  voided: "Void",
};

const GRID = "md:grid md:grid-cols-[7rem_10rem_8rem_minmax(0,1fr)_8rem_5rem_11rem] md:items-center md:gap-3";

export function Register({
  cheques,
  names,
  onChanged,
}: {
  cheques: Cheque[];
  names: CompanyNames;
  onChanged: () => Promise<void>;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const rows = filterAndSort(cheques, filters);
  const issued = issuedSummary(cheques);
  const unassigned = unassignedSummary(cheques);

  async function change(id: string, body: { status: Status } | { company: Company }) {
    setBusy(id);
    setRowError(null);
    try {
      await api<Cheque>(`/api/cheques/${encodeURIComponent(id)}`, "PATCH", body);
    } catch (err) {
      setRowError({ id, message: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    }
    // Refresh either way: after a refusal the row shows what someone else already did.
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

      <div className={`hidden px-3 text-xs font-medium text-muted ${GRID}`}>
        <span>Cheque date</span>
        <span>Company</span>
        <span>Cheque no.</span>
        <span>Payee</span>
        <span className="text-right">Amount</span>
        <span>Status</span>
        <span>Actions</span>
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
                <p className="font-medium">{shortDate(c.issueDate)}</p>
                <p className="text-xs text-muted">{c.issueDate.slice(0, 4)}</p>
                {c.encodedDate && c.encodedDate !== c.issueDate && (
                  <p className="text-xs text-muted">Logged {shortDate(c.encodedDate)}</p>
                )}
              </div>
              <select
                aria-label={`Company for cheque ${c.chequeNo}`}
                className="field"
                value={c.company}
                disabled={busy === c.id}
                onChange={(e) => change(c.id, { company: e.target.value as Company })}
              >
                {COMPANIES.map((co) => (
                  <option key={co} value={co}>
                    {companyLabel(names, co)}
                  </option>
                ))}
              </select>
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
              <div className="flex flex-wrap gap-1.5">
                {nextStatuses(c.status).map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={`btn ${to === "voided" ? "" : "btn-primary"}`}
                    disabled={busy === c.id}
                    onClick={() => change(c.id, { status: to })}
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))}
              </div>
              {rowError?.id === c.id && (
                <p role="alert" className="text-sm text-danger md:col-span-7">
                  {rowError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Write `components/cheque-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { COMPANIES, companyLabel, type Cheque, type Company, type CompanyNames } from "@/lib/types";

type Fields = {
  company: Company;
  chequeNo: string;
  payee: string;
  amount: string;
  issueDate: string;
  bankAccount: string;
  particulars: string;
  status: "issued" | "pending";
};

const blank = (today: string, company: Company = "wwj"): Fields => ({
  company,
  chequeNo: "",
  payee: "",
  amount: "",
  issueDate: today,
  bankAccount: "",
  particulars: "",
  status: "issued",
});

export function ChequeForm({
  today,
  names,
  onSaved,
}: {
  today: string;
  names: CompanyNames;
  onSaved: () => Promise<void>;
}) {
  const [f, setF] = useState<Fields>(() => blank(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setF((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const saved = await api<Cheque>("/api/cheques", "POST", f);
      setMessage({ kind: "ok", text: `Saved cheque ${saved.chequeNo}.` });
      setF(blank(today, f.company));
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors ?? {});
        setMessage({ kind: "error", text: err.message });
      } else setMessage({ kind: "error", text: "Something went wrong. Try again." });
    }
    setSaving(false);
  }

  const text = (key: "chequeNo" | "payee" | "amount" | "bankAccount" | "particulars", label: string, extra = {}) => (
    <label className="space-y-1 text-sm">
      <span className="block text-muted">{label}</span>
      <input
        className="field"
        value={f[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={!!errors[key] || undefined}
        {...extra}
      />
      {errors[key] && <span className="block text-danger">{errors[key]}</span>}
    </label>
  );

  return (
    <section aria-labelledby="form-heading" className="space-y-3">
      <h2 id="form-heading" className="text-lg font-semibold">
        New cheque
      </h2>
      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Company</span>
          <select className="field" value={f.company} onChange={(e) => set("company", e.target.value as Company)}>
            {COMPANIES.map((co) => (
              <option key={co} value={co}>
                {companyLabel(names, co)}
              </option>
            ))}
          </select>
          {errors.company && <span className="block text-danger">{errors.company}</span>}
        </label>
        {text("chequeNo", "Cheque no.", { required: true })}
        {text("payee", "Payee", { required: true })}
        {text("amount", "Amount (₱)", { required: true, inputMode: "decimal", placeholder: "0.00" })}
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Cheque date</span>
          <input
            type="date"
            className="field"
            required
            value={f.issueDate}
            onChange={(e) => set("issueDate", e.target.value)}
            aria-invalid={!!errors.issueDate || undefined}
          />
          {errors.issueDate && <span className="block text-danger">{errors.issueDate}</span>}
        </label>
        {text("bankAccount", "Bank account (optional)", { placeholder: "BDO Current 1234" })}
        {text("particulars", "Particulars (CR / SI / DR)")}
        <label className="space-y-1 text-sm">
          <span className="block text-muted">Status</span>
          <select className="field" value={f.status} onChange={(e) => set("status", e.target.value as Fields["status"])}>
            <option value="issued">Issued</option>
            <option value="pending">Pending</option>
          </select>
          {errors.status && <span className="block text-danger">{errors.status}</span>}
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn btn-primary h-10 px-5" disabled={saving}>
            {saving ? "Saving…" : "Save cheque"}
          </button>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : ""}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 5: Write `components/header.tsx`**

```tsx
"use client";

import { useState } from "react";
import { logout } from "@/app/login/actions";
import { api, ApiError } from "@/lib/api";
import type { CompanyNames } from "@/lib/types";

const KEYS = ["wwj", "wythlae", "wwjcorp"] as const;

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Private windows may block storage; the choice then lasts until the page is closed.
  }
}

export function Header({ names, onChanged }: { names: CompanyNames; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState<CompanyNames | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api<CompanyNames>("/api/companies", "PUT", draft);
      await onChanged();
      setDraft(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    setSaving(false);
  }

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Cheque Funding Tracker</h1>
        <button type="button" className="btn" onClick={toggleTheme}>
          Light / dark
        </button>
        <form action={logout}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      </div>
      {draft ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          {KEYS.map((key) => (
            <label key={key} className="space-y-1 text-sm">
              <span className="block text-muted">Company name</span>
              <input
                className="field"
                required
                maxLength={60}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <button type="submit" className="btn btn-primary h-10" disabled={saving}>
            {saving ? "Saving…" : "Save names"}
          </button>
          <button type="button" className="btn h-10" onClick={() => setDraft(null)}>
            Cancel
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {KEYS.map((key) => (
            <span key={key} className="rounded-full bg-mint px-3 py-1">
              {names[key]}
            </span>
          ))}
          <button type="button" className="btn" onClick={() => setDraft(names)}>
            Edit names
          </button>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Write `components/tracker.tsx` and `app/page.tsx`**

`components/tracker.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { buildCalendar } from "@/lib/calendar";
import type { Cheque, CompanyNames } from "@/lib/types";
import { ChequeForm } from "./cheque-form";
import { FundingCalendar } from "./funding-calendar";
import { Header } from "./header";
import { Register } from "./register";

type State = { today: string; companies: CompanyNames; cheques: Cheque[] };

const REFRESH_MS = 30_000;

export function Tracker() {
  const [state, setState] = useState<State | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setProblem(null);
    } catch (err) {
      // Keep showing the last data; the next cycle tries again.
      setProblem(err instanceof ApiError ? err.message : "Couldn't refresh.");
    }
  }, []);

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
      <FundingCalendar days={buildCalendar(state.cheques, state.today)} names={state.companies} />
      <ChequeForm key={state.today} today={state.today} names={state.companies} onSaved={refresh} />
      <Register cheques={state.cheques} names={state.companies} onChanged={refresh} />
    </main>
  );
}
```

`app/page.tsx` (replace):
```tsx
import { Tracker } from "@/components/tracker";

export default function Page() {
  return <Tracker />;
}
```

- [ ] **Step 7: Typecheck and build**

Run: `npm.cmd run typecheck`
Expected: no errors.
Run: `npm.cmd run build`
Expected: "Compiled successfully"; routes `/`, `/login`, `/api/state`, `/api/cheques`, `/api/cheques/[id]`, `/api/companies` listed.

- [ ] **Step 8: Browser run-through at http://localhost:3002** (dev server in the Terminal panel; password `admin`)

Check each, on the dev database that now holds the imported cheques. Add only made-up test cheques, and void them afterwards:
1. `/` redirects to `/login`; a wrong password shows "Wrong password."; `admin` signs in.
2. The calendar shows 14 cards starting "Today"; the banner reads either "Fund the bank account before these clear:" with a list, or "Nothing clearing in the next 2 days."
3. The register hides cleared and voided rows; unticking "Hide cleared & voided" shows them. Unassigned rows are amber.
4. Submit the form empty-handed with amount `0`: field errors appear and nothing is saved.
5. Add a cheque (payee "Test Payee", amount `1,234.50`, cheque date today, status Pending). It appears in the register and not in the calendar.
6. "Mark issued": today's card and the banner now include ₱1,234.50. "Mark cleared": they drop it again.
7. Add the same cheque no. for the same company again while the first exists un-voided: "already in the register".
8. Change a row's company from the dropdown; the calendar split follows.
9. "Edit names", rename a company, save; the new name shows in the header, dropdowns and calendar. Rename it back.
10. Open the page in a second browser tab, change a status in one, and see it in the other within 30 seconds.
11. Narrow the window to phone width (375 px): no sideways scrolling; rows stack.
12. "Light / dark" switches the palette and stays after a reload.
13. "Sign out" returns to `/login`.

Fix anything that fails before committing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: tracker page with funding calendar, register and new cheque form"
```

---

### Task 8: Deploy files and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `README.md`

**Interfaces:**
- Consumes: `NEXT_STANDALONE`, `CHEQUES_DB_PATH`, `ADMIN_PASSWORD`, `SESSION_SECRET`; the startup import of `<database folder>/cheques-import.json`.
- Produces: an image that serves the app on port 3000 with data in `/data`.

- [ ] **Step 1: Write the files**

`Dockerfile`:
```dockerfile
# Cheque tracker on Fly.io: Next.js standalone server + node:sqlite. Data lives on a volume at /data.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build && rm -rf .next/standalone/data

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Manila \
    CHEQUES_DB_PATH=/data/cheques.db
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`:
```
# Never ship local data, secrets or build output into the image.
node_modules
.next
.next-dev
data
.env*
!.env.example
.git
tests
docs
*.log
```

`fly.toml`:
```toml
# Fly.io settings for the cheque tracker.
app = "wwj-cheques"
primary_region = "sin"   # Singapore, closest to Cebu

[build]

[http_service]
  internal_port = 3000
  force_https = true
  # One always-on machine: SQLite lives on a single volume and the daily backup needs it running.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "20s"
    interval = "30s"
    method = "GET"
    path = "/login"
    timeout = "5s"

[[mounts]]
  source = "cheques_data"
  destination = "/data"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

`README.md`:
````markdown
# Cheque Funding Tracker

How much will clear, from which company, on each of the next 14 days. One shared password.

Design: `docs/superpowers/specs/2026-10-03-cheque-tracker-design.md`

## Run locally

```
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3002 and sign in with `admin`. Data is in `data/cheques.db` (git-ignored).

Tests: `npm.cmd test`

## Loading cheques

Put a file named `cheques-import.json` next to the database (`data/` locally, `/data` on Fly.io) and
restart the app. It is loaded once, by id, so loading the same file again never duplicates rows. The
file is then renamed `cheques-import.imported-<date>.json`, and the server log prints a line starting
`[import]` with the count and totals by company. If a row is unusable, nothing is loaded and the log
says which row.

Real payees and amounts stay out of git: `data/` is ignored.

## Deploy to Fly.io

`flyctl` is at `%USERPROFILE%\.fly\bin\flyctl.exe` (not on PATH). First time:

```
$fly = "$env:USERPROFILE\.fly\bin\flyctl.exe"
& $fly apps create wwj-cheques
& $fly volumes create cheques_data --app wwj-cheques --region sin --size 1
& $fly secrets set ADMIN_PASSWORD="<choose a password>" SESSION_SECRET="<long random text>" --app wwj-cheques
& $fly deploy --app wwj-cheques --ha=false --remote-only --depot=false
```

Load the cheques (once):

```
& $fly ssh sftp put data\cheques-import.json /data/cheques-import.json --app wwj-cheques
& $fly apps restart wwj-cheques
& $fly logs --app wwj-cheques
```

Look for the `[import]` line in the logs. Later deploys are only the `deploy` command.

Backups: a copy of the database is written to `/data/backups/` each day; the last 30 are kept.
````

- [ ] **Step 2: Check the production build the way Docker runs it**

Run in PowerShell:
```powershell
$env:NEXT_STANDALONE = "1"; $env:NEXT_DIST_DIR = ".next-sa"; npm.cmd run build; Remove-Item Env:NEXT_STANDALONE, Env:NEXT_DIST_DIR
```
Expected: "Compiled successfully" and a `.next-sa/standalone/server.js` file. Then remove the folder: `Remove-Item -Recurse -Force .next-sa`. Add `.next-sa/` to `.gitignore` and `.next-sa` to `.dockerignore`.

- [ ] **Step 3: Run the full test suite once more**

Run: `npm.cmd test`
Expected: PASS, 9 files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Dockerfile, Fly.io config and README"
```

- [ ] **Step 5: Hand over to the owner**

The owner runs the commands in the README ("Deploy to Fly.io", then "Load the cheques"), because `flyctl` commands against production are theirs to run. Creating the private GitHub repo `jtpepito/cheque-tracker` and pushing also needs the owner's go-ahead: ask before running `gh repo create jtpepito/cheque-tracker --private --source . --push`.

Report to the owner: the `[import]` summary line from Task 6 Step 6 against the source spec §7 figures, and any step of the browser run-through that needed a fix.
