# Vercel + Supabase Hosting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tracker's data from a SQLite file to Postgres (Supabase) and host it on Vercel, with no change in what the page or the sheet sync does.

**Architecture:** A small `Sql` interface (`query`, `exec`, `tx`) with two implementations: `pg` for production and PGlite (in-process Postgres) for tests and local development. The store modules (`cheques`, `import`, `sync`) become async and take an `Sql`. Tables come from a migration file. The pure rule modules are untouched.

**Tech Stack:** Existing app, plus `pg`, `@electric-sql/pglite`, `tsx` (for the two command-line scripts), Vercel, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-10-03-vercel-supabase-design.md`

## Global Constraints

- Project folder `C:\WWJ\Claude Coding\Cheques`; use `npm.cmd` / `npx.cmd`.
- Dates stay `text` (`YYYY-MM-DD`), never Postgres `date`, so no time zone can shift them. `amount` is `numeric(14,2)`; `created_at` and `login_failures.at` are `bigint`. Mappers convert with `Number(...)` so both drivers behave the same.
- SQL uses `$1, $2, …` parameters only. No string-built values.
- Production without `DATABASE_URL` is an error, never a fallback.
- `.env.production.local` is git-ignored and holds real secrets. Never print its values, never commit them, never put them in a command line that is echoed.
- Real payees and amounts never enter git. Tests use made-up data.
- Vercel: team `wwj10`, project `cheque-tracker`, function region `sin1`. Supabase: project `cheque-tracker`, Singapore, transaction pooler (port 6543).
- Never write a log file inside the project while `next dev` runs.
- End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A sync or import fails half-way.** Nothing is saved: everything is in one transaction on one connection. Tests in Task 2 (existing all-or-nothing tests, now on Postgres).
2. **Numbers come back as text from Postgres.** Amounts and timestamps are numbers everywhere the app uses them, so totals never concatenate ("100" + "50"). Test in Task 2.
3. **Production starts without a database address.** It refuses, loudly. Test in Task 1.
4. **Wrong passwords from many function instances.** The lockout counts across instances because it is in the database, expires after 15 minutes and resets on success. Tests in Task 3.
5. **A dry-run sync.** It leaves no trace in the database even though it ran inside a transaction. Existing test in Task 2.

## File Structure

| File | Responsibility |
|---|---|
| `lib/sql.ts` (new) | The `Sql` interface |
| `lib/sql-pg.ts` (new) | `pg` implementation |
| `lib/sql-pglite.ts` (new) | PGlite implementation |
| `db/migrations/001_init.sql` (new) | Tables, checks, row level security |
| `lib/migrate.ts` (new) | Apply migration files; seed the holidays once |
| `lib/db.ts` (rewritten) | `chooseStorage`, `getSql()` |
| `lib/login-throttle.ts` (new) | Sign-in lockout in the database |
| `lib/cheques.ts`, `lib/import.ts`, `lib/sync.ts` | Async, on `Sql` |
| `scripts/migrate.ts`, `scripts/load-cheques.ts` (new) | The two commands |
| `tests/db.ts` (new) | One PGlite per test file, emptied between tests |
| Deleted | `lib/backup.ts`, `lib/throttle.ts`, `tests/throttle.test.ts`, `instrumentation.ts`, `Dockerfile`, `.dockerignore`, `fly.toml` |

---

### Task 1: The storage interface, both drivers, the migration

**Files:**
- Create: `lib/sql.ts`, `lib/sql-pg.ts`, `lib/sql-pglite.ts`, `db/migrations/001_init.sql`, `lib/migrate.ts`, `tests/db.ts`
- Modify: `package.json` (dependencies and scripts)
- Test: `tests/migrate.test.ts`, `tests/storage.test.ts`

**Interfaces:**
- Produces:
  - `type Sql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>; exec(text: string): Promise<void>; tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> }`
  - `pgSql(url: string): Sql`, `pgliteSql(dataDir?: string): Promise<Sql>`
  - `migrate(sql: Sql): Promise<string[]>` (names applied), `seedHolidays(sql: Sql): Promise<void>`
  - `chooseStorage(env: { DATABASE_URL?: string; VERCEL?: string; NODE_ENV?: string }): "pg" | "pglite"` (in `lib/storage.ts`, pure)
  - `tests/db.ts`: `testSql(): Promise<Sql>`, `resetDb(sql: Sql): Promise<void>`

- [ ] **Step 1: Add the packages**

Run: `npm.cmd install pg @electric-sql/pglite` and `npm.cmd install -D tsx @types/pg`.
In `package.json` scripts add:
```json
"migrate": "node --conditions=react-server --import tsx scripts/migrate.ts",
"load-cheques": "node --conditions=react-server --import tsx scripts/load-cheques.ts"
```

- [ ] **Step 2: Write the failing tests**

`tests/storage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { chooseStorage } from "@/lib/storage";

describe("chooseStorage", () => {
  it("uses Postgres when a database address is set", () => {
    expect(chooseStorage({ DATABASE_URL: "postgres://x", NODE_ENV: "production", VERCEL: "1" })).toBe("pg");
    expect(chooseStorage({ DATABASE_URL: "postgres://x", NODE_ENV: "development" })).toBe("pg");
  });
  it("uses the local database in development and tests", () => {
    expect(chooseStorage({ NODE_ENV: "development" })).toBe("pglite");
    expect(chooseStorage({ NODE_ENV: "test" })).toBe("pglite");
    expect(chooseStorage({})).toBe("pglite");
  });
  it("refuses to run in production or on Vercel without a database address", () => {
    expect(() => chooseStorage({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() => chooseStorage({ VERCEL: "1", NODE_ENV: "development" })).toThrow(/DATABASE_URL/);
    expect(() => chooseStorage({ DATABASE_URL: "", NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });
});
```

`tests/migrate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PH_HOLIDAYS_2026 } from "@/lib/banking";
import { migrate } from "@/lib/migrate";
import { pgliteSql } from "@/lib/sql-pglite";

describe("migrate", () => {
  it("creates every table, seeds the holidays once, and does nothing the second time", async () => {
    const sql = await pgliteSql();
    expect(await migrate(sql)).toEqual(["001_init.sql"]);
    const tables = await sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.map((t) => t.table_name)).toEqual(["cheques", "config", "holidays", "login_failures", "schema_migrations"]);
    const holidays = await sql.query("SELECT date, name FROM holidays ORDER BY date");
    expect(holidays).toEqual(PH_HOLIDAYS_2026);

    await sql.query("DELETE FROM holidays WHERE date = $1", ["2026-12-08"]);
    expect(await migrate(sql)).toEqual([]);
    expect(await sql.query("SELECT 1 FROM holidays WHERE date = $1", ["2026-12-08"])).toEqual([]);
  });

  it("rolls back everything in a transaction that throws, and returns the value of one that does not", async () => {
    const sql = await pgliteSql();
    await migrate(sql);
    await expect(
      sql.tx(async (t) => {
        await t.query("INSERT INTO config (key, value) VALUES ($1, $2)", ["k", "v"]);
        throw new Error("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await sql.query("SELECT 1 FROM config WHERE key = $1", ["k"])).toEqual([]);
    expect(await sql.tx(async (t) => (await t.query<{ n: number }>("SELECT 7 AS n"))[0].n)).toBe(7);
  });
});
```

Run: `npm.cmd test` — expected: FAIL, cannot resolve `@/lib/storage`, `@/lib/migrate`, `@/lib/sql-pglite`.

- [ ] **Step 3: Write the implementation**

`lib/sql.ts`:
```ts
/** The one way the app talks to its database. Implemented for pg (production) and PGlite (tests, local). */
export type Sql = {
  /** One statement with $1, $2 … parameters. Returns its rows. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** One or more statements without parameters (migrations). */
  exec(text: string): Promise<void>;
  /** Runs fn in one transaction on one connection; rolls back if it throws. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};
```

`lib/storage.ts`:
```ts
/** Which database to use. Production must never fall back to storage that resets. */
export function chooseStorage(env: { DATABASE_URL?: string; VERCEL?: string; NODE_ENV?: string }): "pg" | "pglite" {
  if (env.DATABASE_URL) return "pg";
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. The app will not run without its database.");
  }
  return "pglite";
}
```

`lib/sql-pglite.ts`:
```ts
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./sql";

type Runner = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (text: string) => Promise<unknown> };

function wrap(run: Runner, tx: Sql["tx"]): Sql {
  return {
    query: async <T>(text: string, params?: unknown[]) => (await run.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await run.exec(text);
    },
    tx,
  };
}

/** In-process Postgres. No dataDir: in memory (tests). With one: kept on disk (local development). */
export async function pgliteSql(dataDir?: string): Promise<Sql> {
  const db = new PGlite(dataDir);
  await db.waitReady;
  return wrap(db as unknown as Runner, (fn) =>
    db.transaction(async (t) => {
      const inner: Sql = wrap(t as unknown as Runner, (f) => f(inner));
      return fn(inner);
    }) as Promise<never>,
  );
}
```

`lib/sql-pg.ts`:
```ts
import { Pool, type PoolClient } from "pg";
import type { Sql } from "./sql";

/** Postgres over the network (Supabase's transaction pooler). */
export function pgSql(url: string): Sql {
  // Supabase's pooler certificate is not in Node's default trust store.
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, ssl: { rejectUnauthorized: false } });
  const on = (run: Pool | PoolClient, tx: Sql["tx"]): Sql => ({
    query: async <T>(text: string, params?: unknown[]) => (await run.query(text, params)).rows as T[],
    exec: async (text: string) => {
      await run.query(text);
    },
    tx,
  });
  return on(pool, async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inner: Sql = on(client, (f) => f(inner));
      const out = await fn(inner);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Keep the original error.
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
```

`db/migrations/001_init.sql`:
```sql
-- Cheque tracker tables. Dates are text (YYYY-MM-DD) so no time zone can shift them.

CREATE TABLE cheques (
  id             text PRIMARY KEY,
  company        text NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp','unassigned')),
  cheque_no      text NOT NULL,
  payee          text NOT NULL,
  amount         numeric(14,2),
  issue_date     text NOT NULL,
  encoded_date   text,
  bank_account   text NOT NULL DEFAULT '',
  particulars    text NOT NULL DEFAULT '',
  status         text NOT NULL CHECK (status IN ('pending','issued','cleared','voided')),
  created_at     bigint NOT NULL,
  imported       boolean NOT NULL DEFAULT false,
  company_basis  text,
  source_row     integer,
  company_locked boolean NOT NULL DEFAULT false
);
CREATE INDEX cheques_issue_date ON cheques (issue_date);

CREATE TABLE config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Days with no bank clearing, besides weekends.
CREATE TABLE holidays (
  date text PRIMARY KEY,
  name text NOT NULL
);

-- Wrong sign-in passwords, for the lockout.
CREATE TABLE login_failures (
  who text NOT NULL,
  at  bigint NOT NULL
);
CREATE INDEX login_failures_who_at ON login_failures (who, at);

-- Only the app's own server connection uses these tables. With row level security on and no
-- policies, Supabase's public API can read and write nothing.
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_failures ENABLE ROW LEVEL SECURITY;
```

`lib/migrate.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { PH_HOLIDAYS_2026 } from "./banking";
import type { Sql } from "./sql";

export async function seedHolidays(sql: Sql): Promise<void> {
  for (const h of PH_HOLIDAYS_2026) {
    await sql.query("INSERT INTO holidays (date, name) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING", [h.date, h.name]);
  }
}

/** Applies migration files not yet applied, in name order. Returns the names it applied. */
export async function migrate(sql: Sql, dir: string = path.join(process.cwd(), "db", "migrations")): Promise<string[]> {
  await sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at bigint NOT NULL)");
  await sql.exec("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY");
  const done = new Set((await sql.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    await sql.tx(async (t) => {
      await t.exec(text);
      await t.query("INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)", [name, Date.now()]);
      // The national holidays are seeded with the first migration only, so one removed in the page stays removed.
      if (name === "001_init.sql") await seedHolidays(t);
    });
    applied.push(name);
  }
  return applied;
}
```

`tests/db.ts`:
```ts
import { migrate, seedHolidays } from "@/lib/migrate";
import type { Sql } from "@/lib/sql";
import { pgliteSql } from "@/lib/sql-pglite";

let shared: Promise<Sql> | undefined;

/** One in-memory Postgres per test file (starting one takes a moment); call resetDb before each test. */
export function testSql(): Promise<Sql> {
  shared ??= (async () => {
    const sql = await pgliteSql();
    await migrate(sql);
    return sql;
  })();
  return shared;
}

export async function resetDb(sql: Sql): Promise<void> {
  await sql.exec("TRUNCATE cheques, config, holidays, login_failures");
  await seedHolidays(sql);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm.cmd test` — expected: the two new files PASS; all older tests still PASS (nothing else changed yet).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): Sql interface with pg and PGlite drivers, first migration"
```

---

### Task 2: The stores on Postgres

**Files:**
- Rewrite: `lib/db.ts`, `lib/cheques.ts`
- Modify: `lib/import.ts`, `lib/sync.ts`
- Delete: `lib/backup.ts`, `instrumentation.ts`
- Tests rewritten to async on PGlite: `tests/cheques.test.ts`, `tests/import.test.ts`, `tests/sync.test.ts`, `tests/banking.test.ts` (its "holidays store" part)

**Interfaces:**
- Consumes: Task 1.
- Produces (same names and meanings as before; every one now `async`, first argument `sql: Sql`):
  - `lib/db.ts`: `getSql(): Promise<Sql>`
  - `lib/cheques.ts`: `listCheques`, `upsertCheque`, `removeCheque`, `setCompany`, `getCompanyNames`, `setCompanyNames`, `listHolidays`, `addHoliday`, `removeHoliday`, `ChequeError`
  - `lib/import.ts`: `importCheques(sql, file): Promise<{ count: number; summary: string }>`; `importIfPresent` is removed
  - `lib/sync.ts`: `applySync(sql, payload, now?)`, `getLastSync(sql)`, `recordRefusal(sql, message, now?)`, `getLastRefusal(sql)`; `parsePayload`, `SyncRefused`, `MAX_REMOVALS` unchanged

- [ ] **Step 1: Convert the tests first**

Apply these rules to the four test files, then check each file by eye:
- Replace the `openDatabase(":memory:")` setup with:
  ```ts
  import { resetDb, testSql } from "./db";
  import type { Sql } from "@/lib/sql";
  let sql: Sql;
  beforeEach(async () => {
    sql = await testSql();
    await resetDb(sql);
  });
  ```
- Every `it(...)` callback that touches the store becomes `async`; every store call gains `await` and takes `sql` in place of `db`.
- `expect(() => call).toThrow(x)` on a store call becomes `await expect(call).rejects.toThrow(x)`. A `try { call; expect.unreachable() } catch (e) { … }` block keeps its shape with `await call`.
- Helper lambdas that read the store (`byId`, `codeOf`) become `async` and are awaited.
- `tests/cheques.test.ts`: delete the "adds the lock column to a database made before it existed" test (there is no older Postgres database to upgrade). Add:
  ```ts
  it("returns amounts and timestamps as numbers, not text", async () => {
    await upsertCheque(sql, cheque({ id: "n-1", amount: 100.5, createdAt: 1759449600000 }));
    await upsertCheque(sql, cheque({ id: "n-2", amount: null }));
    const all = await listCheques(sql);
    const one = all.find((c) => c.id === "n-1")!;
    expect(one.amount).toBe(100.5);
    expect(typeof one.createdAt).toBe("number");
    expect(one.createdAt).toBe(1759449600000);
    expect(all.find((c) => c.id === "n-2")!.amount).toBeNull();
    expect(typeof one.imported).toBe("boolean");
  });
  ```
- `tests/import.test.ts`: delete the whole `describe("importIfPresent", …)` block and the two `importIfPresent` tests inside "import strictness" (the rename tests); remove the now-unused `fs`, `os`, `path` imports.
- `tests/sync.test.ts`: the "refuses to remove more than 20" and "refuses a sync with no readable cheque rows" tests keep their `try/catch` shape with `await`.

Run: `npm.cmd test` — expected: FAIL in these four files (the stores are still synchronous SQLite).

- [ ] **Step 2: Rewrite `lib/db.ts`**

```ts
import "server-only";
import path from "node:path";
import type { Sql } from "./sql";
import { chooseStorage } from "./storage";

// One database handle per server process. Kept on globalThis so dev-mode hot reloads reuse it.
const globalForDb = globalThis as unknown as { __chequesSql?: Promise<Sql> };

async function open(): Promise<Sql> {
  if (chooseStorage(process.env) === "pg") {
    const { pgSql } = await import("./sql-pg");
    return pgSql(process.env.DATABASE_URL!);
  }
  // Local development: an in-process Postgres kept in data/pglite, with its tables made on first use.
  const { pgliteSql } = await import("./sql-pglite");
  const { migrate } = await import("./migrate");
  const sql = await pgliteSql(path.join(process.cwd(), "data", "pglite"));
  await migrate(sql);
  return sql;
}

export function getSql(): Promise<Sql> {
  globalForDb.__chequesSql ??= open().catch((err) => {
    globalForDb.__chequesSql = undefined;
    throw err;
  });
  return globalForDb.__chequesSql;
}
```

- [ ] **Step 3: Rewrite `lib/cheques.ts`**

```ts
import "server-only";
import type { Holiday } from "./banking";
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
  };
}

export async function listCheques(sql: Sql): Promise<Cheque[]> {
  return (await sql.query<Row>("SELECT * FROM cheques ORDER BY issue_date, cheque_no")).map(toCheque);
}

/** Inserts the cheque, or replaces every field of the row with the same id. */
export async function upsertCheque(sql: Sql, c: Cheque): Promise<void> {
  await sql.query(
    `INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, encoded_date, bank_account,
                          particulars, status, created_at, imported, company_basis, source_row, company_locked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO UPDATE SET
       company = excluded.company, cheque_no = excluded.cheque_no, payee = excluded.payee,
       amount = excluded.amount, issue_date = excluded.issue_date, encoded_date = excluded.encoded_date,
       bank_account = excluded.bank_account, particulars = excluded.particulars, status = excluded.status,
       created_at = excluded.created_at, imported = excluded.imported,
       company_basis = excluded.company_basis, source_row = excluded.source_row,
       company_locked = excluded.company_locked`,
    [
      c.id, c.company, c.chequeNo, c.payee, c.amount, c.issueDate, c.encodedDate, c.bankAccount,
      c.particulars, c.status, c.createdAt, c.imported, c.companyBasis, c.sourceRow, c.companyLocked,
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
```

- [ ] **Step 4: Convert `lib/import.ts` and `lib/sync.ts`**

`lib/import.ts`:
- Remove `importIfPresent`, the `fs` import and the `todayManila` import.
- `summarize` and `importCheques` become `async` on `sql: Sql`. The body of `importCheques` after validation becomes:
  ```ts
  await sql.tx(async (t) => {
    // The file wins for everything except a company chosen by hand in the app.
    const locked = new Map((await listCheques(t)).filter((c) => c.companyLocked).map((c) => [c.id, c]));
    for (const c of cheques) {
      const keep = locked.get(c.id);
      await upsertCheque(t, keep ? { ...c, company: keep.company, companyBasis: keep.companyBasis, companyLocked: true } : c);
    }
    if (file.companies) await setCompanyNames(t, { ...(await getCompanyNames(t)), ...file.companies });
  });
  return { count: cheques.length, summary: await summarize(sql) };
  ```

`lib/sync.ts`:
- `applySync(sql: Sql, payload, now)` becomes `async`. Reading and checking the rows (the `problems`/`good` loop and the "no readable rows" refusal) stays before the transaction. Everything from `const existing = …` to the end runs inside `sql.tx(async (t) => { … })` using `t`, with every store call awaited.
- A dry run must roll back. Inside the transaction, after computing the report, a dry run does `throw new DryRunDone(report)`; `applySync` catches exactly that and returns its report:
  ```ts
  class DryRunDone extends Error {
    constructor(public report: SyncReport) {
      super("dry run");
    }
  }
  …
  try {
    return await sql.tx(async (t) => {
      …
      if (payload.dryRun) throw new DryRunDone(report);
      await setConfig(t, "last_sync", JSON.stringify(report));
      await deleteConfig(t, "last_sync_refusal");
      return report;
    });
  } catch (err) {
    if (err instanceof DryRunDone) return err.report;
    throw err;
  }
  ```
- The removal-guard `throw new SyncRefused(409, …)` stays inside the transaction, so it rolls back.
- `getLastSync`, `recordRefusal`, `getLastRefusal` become `async` using `getConfigJson` / `setConfig` from `lib/cheques.ts`.
- The manual `BEGIN` / `COMMIT` / `ROLLBACK` calls are removed.

Delete `lib/backup.ts` and `instrumentation.ts`.

- [ ] **Step 5: Run the tests**

Run: `npm.cmd test` — expected: PASS for `cheques`, `import`, `sync`, `banking`, `migrate`, `storage` and every pure-module test. (`npm.cmd run typecheck` still fails in the routes; Task 4 fixes them.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): cheque, import and sync stores on Postgres"
```

---

### Task 3: Sign-in lockout in the database

**Files:**
- Create: `lib/login-throttle.ts`
- Delete: `lib/throttle.ts`, `tests/throttle.test.ts`
- Test: `tests/login-throttle.test.ts`

**Interfaces:**
- Produces: `MAX_FAILURES = 10`, `WINDOW_MS = 15 * 60 * 1000`, `isBlocked(sql, who, now?): Promise<boolean>`, `recordFailure(sql, who, now?): Promise<void>`, `clearFailures(sql, who): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/login-throttle.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearFailures, isBlocked, MAX_FAILURES, recordFailure, WINDOW_MS } from "@/lib/login-throttle";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const failTimes = async (who: string, times: number, at: number) => {
  for (let i = 0; i < times; i++) await recordFailure(sql, who, at + i);
};

describe("sign-in lockout", () => {
  it("blocks an address after ten wrong passwords inside the window, and only that address", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES - 1, 1000);
    expect(await isBlocked(sql, "1.1.1.1", 2000)).toBe(false);
    await recordFailure(sql, "1.1.1.1", 2000);
    expect(await isBlocked(sql, "1.1.1.1", 3000)).toBe(true);
    expect(await isBlocked(sql, "2.2.2.2", 3000)).toBe(false);
  });

  it("lets the address try again once the window has passed", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES, 1000);
    expect(await isBlocked(sql, "1.1.1.1", 1000 + WINDOW_MS - 1)).toBe(true);
    expect(await isBlocked(sql, "1.1.1.1", 1000 + MAX_FAILURES + WINDOW_MS)).toBe(false);
  });

  it("forgets failures after a correct password", async () => {
    await failTimes("1.1.1.1", MAX_FAILURES, 1000);
    await clearFailures(sql, "1.1.1.1");
    expect(await isBlocked(sql, "1.1.1.1", 2000)).toBe(false);
  });

  it("clears out old failures as new ones are recorded", async () => {
    await failTimes("1.1.1.1", 3, 1000);
    await recordFailure(sql, "2.2.2.2", 1000 + WINDOW_MS + 5000);
    expect(await sql.query("SELECT 1 FROM login_failures WHERE who = $1", ["1.1.1.1"])).toEqual([]);
  });
});
```

Run: `npm.cmd test` — expected: FAIL, cannot resolve `@/lib/login-throttle`.

- [ ] **Step 2: Write `lib/login-throttle.ts`**

```ts
import type { Sql } from "./sql";

// Wrong passwords are counted in the database, because Vercel runs many function instances
// that do not share memory.

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

export async function isBlocked(sql: Sql, who: string, now: number = Date.now()): Promise<boolean> {
  const rows = await sql.query<{ n: unknown }>("SELECT count(*) AS n FROM login_failures WHERE who = $1 AND at > $2", [
    who,
    now - WINDOW_MS,
  ]);
  return Number(rows[0].n) >= MAX_FAILURES;
}

export async function recordFailure(sql: Sql, who: string, now: number = Date.now()): Promise<void> {
  await sql.query("DELETE FROM login_failures WHERE at <= $1", [now - WINDOW_MS]);
  await sql.query("INSERT INTO login_failures (who, at) VALUES ($1, $2)", [who, now]);
}

export async function clearFailures(sql: Sql, who: string): Promise<void> {
  await sql.query("DELETE FROM login_failures WHERE who = $1", [who]);
}
```

Delete `lib/throttle.ts` and `tests/throttle.test.ts`.

- [ ] **Step 3: Run the tests, then commit**

Run: `npm.cmd test` — expected: PASS including `tests/login-throttle.test.ts`.

```bash
git add -A
git commit -m "feat(db): sign-in lockout counted in the database"
```

---

### Task 4: Routes, sign-in and build on the new storage; Fly.io files removed

**Files:**
- Modify: `app/api/state/route.ts`, `app/api/cheques/[id]/route.ts`, `app/api/companies/route.ts`, `app/api/holidays/route.ts`, `app/api/holidays/[date]/route.ts`, `app/api/sync/route.ts`, `app/login/actions.ts`, `next.config.ts`, `.env.example`, `.gitignore`
- Create: `vercel.json`
- Delete: `Dockerfile`, `.dockerignore`, `fly.toml`

**Interfaces:**
- Consumes: `getSql()` and the async stores (Task 2); the lockout (Task 3).
- Produces: the same HTTP routes as before, now on Postgres.

- [ ] **Step 1: Change the routes**

In every route, `getDb()` becomes `await getSql()` (import `getSql` from `@/lib/db`), and every store call is awaited. The handlers passed to `guarded` are already async or become async. In `app/api/state/route.ts` read the five things in parallel:
```ts
const sql = await getSql();
const [companies, holidays, sync, refusal, cheques] = await Promise.all([
  getCompanyNames(sql), listHolidays(sql), getLastSync(sql), getLastRefusal(sql), listCheques(sql),
]);
```
In `app/api/sync/route.ts`: `applySync(await getSql(), payload)` and `await recordRefusal(await getSql(), err.message)`.

In `app/login/actions.ts`, replace the in-memory throttle:
```ts
const sql = await getSql();
if (await isBlocked(sql, who)) return { error: "Too many wrong passwords. Try again in 15 minutes." };
if (!checkPassword(String(fd.get("password") ?? ""))) {
  await recordFailure(sql, who);
  await new Promise((r) => setTimeout(r, 600));
  return { error: "Wrong password." };
}
await clearFailures(sql, who);
```
and remove the `createThrottle` import and constant.

- [ ] **Step 2: Build settings**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server builds into its own folder so it can run next to a local production build.
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // Database drivers are loaded by Node at run time, not bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
```

`vercel.json`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"]
}
```

`.env.example`: replace the `CHEQUES_DB_PATH` lines with:
```
# Postgres connection string (Supabase transaction pooler, port 6543). Required in production.
# Leave unset locally: the app then uses an in-process database in data/pglite.
DATABASE_URL=
```

Delete `Dockerfile`, `.dockerignore`, `fly.toml`. In `.gitignore`, remove the `.next-sa/` line and add `.vercel/`.

- [ ] **Step 3: Typecheck, test, build**

Run: `npm.cmd run typecheck` — expected: no errors.
Run: `npm.cmd test` — expected: PASS.
Run (PowerShell): `$env:NEXT_DIST_DIR=".next-check"; npm.cmd run build; Remove-Item Env:NEXT_DIST_DIR; Remove-Item -Recurse -Force .next-check` — expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): routes and sign-in on Postgres; Vercel config; Fly.io files removed"
```

---

### Task 5: The two commands, local data, README

**Files:**
- Create: `scripts/env.ts`, `scripts/migrate.ts`, `scripts/load-cheques.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `pgSql`, `pgliteSql`, `migrate`, `importCheques`.
- Produces: `npm.cmd run migrate`, `npm.cmd run load-cheques -- <file> [--local]`.

- [ ] **Step 1: Write the scripts**

`scripts/env.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { migrate } from "../lib/migrate";
import type { Sql } from "../lib/sql";

/** DATABASE_URL from the environment, else from .env.production.local. Never printed. */
function databaseUrl(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(process.cwd(), ".env.production.local");
  if (!fs.existsSync(file)) return null;
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  return line ? line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") || null : null;
}

/** The real database, or with --local the development one in data/pglite (stop the dev server first). */
export async function openTarget(local: boolean): Promise<{ sql: Sql; label: string }> {
  if (local) {
    const { pgliteSql } = await import("../lib/sql-pglite");
    const sql = await pgliteSql(path.join(process.cwd(), "data", "pglite"));
    await migrate(sql);
    return { sql, label: "local development database (data/pglite)" };
  }
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set. Put it in .env.production.local, or use --local.");
  const { pgSql } = await import("../lib/sql-pg");
  return { sql: pgSql(url), label: `database at ${new URL(url).hostname}` };
}
```

`scripts/migrate.ts`:
```ts
// Applies new migration files. Usage: npm.cmd run migrate
import { migrate } from "../lib/migrate";
import { openTarget } from "./env";

const { sql, label } = await openTarget(false);
const applied = await migrate(sql);
console.log(`Migrated the ${label}: ${applied.length ? applied.join(", ") : "nothing new to apply"}.`);
process.exit(0);
```

`scripts/load-cheques.ts`:
```ts
// Loads an import file. Usage: npm.cmd run load-cheques -- <file.json> [--local]
import fs from "node:fs";
import { importCheques, type ImportFile } from "../lib/import";
import { openTarget } from "./env";

const args = process.argv.slice(2);
const local = args.includes("--local");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: npm.cmd run load-cheques -- <file.json> [--local]");
  process.exit(1);
}
const { sql, label } = await openTarget(local);
const result = await importCheques(sql, JSON.parse(fs.readFileSync(file, "utf8")) as ImportFile);
console.log(`Loaded ${result.count} cheques into the ${label}.`);
console.log(result.summary);
process.exit(0);
```

- [ ] **Step 2: Load the local development database and check the page**

With the dev server stopped:
```bash
npm.cmd run load-cheques -- data/cheques-import.imported-2026-10-03.json --local
```
Expected: `Loaded 585 cheques …` and the summary line `[import] 585 cheques, ₱43,403,796.08 | wwj 247 ₱24,931,402.19 | wythlae 82 ₱5,179,180.61 | wwjcorp 1 ₱81,267.86 | unassigned 255 ₱13,211,945.42`.

Start the dev server (log outside the project), sign in at http://localhost:3002 and check: the calendar shows Monday 5 Oct ₱387,440.27; "Issued, not yet cleared: ₱4,523,621.33 across 93 cheques."; 57 outstanding cheques have no company. Run the dry-run sync from the sync plan's Task 7 Step 3 again: expected `added 0, removed 0, problems 0, changed 98`. Send one wrong password and confirm "Wrong password." still appears.

- [ ] **Step 3: README**

Replace the "Run locally", "Loading cheques" and "Deploy to Fly.io" sections with:
````markdown
## Run locally

```
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3002 and sign in with `admin`. With no `DATABASE_URL`, data is kept in an
in-process Postgres in `data/pglite` (git-ignored). Tests: `npm.cmd test`.

To load cheques into the local database, stop the dev server and run:

```
npm.cmd run load-cheques -- <file.json> --local
```

## Production: Vercel + Supabase

Data lives in the Supabase project `cheque-tracker` (Singapore); the site runs on Vercel
(project `cheque-tracker`, team `wwj10`, region `sin1`). A push to `main` deploys.

Secrets are set in Vercel (Production): `ADMIN_PASSWORD`, `SESSION_SECRET`, `SYNC_KEY`, `DATABASE_URL`.
`DATABASE_URL` is the Supabase **transaction pooler** string (port 6543). For the two commands below it
is also kept in `.env.production.local` on this PC, which is git-ignored.

```
npm.cmd run migrate
npm.cmd run load-cheques -- <file.json>
```

`migrate` applies new files from `db/migrations`. `load-cheques` loads by id, all or nothing, keeps
companies chosen by hand, and prints the count and totals by company. Backups are Supabase's daily ones.
````
In the "Sync from the Google Sheet" section, change the secret step to: "Set `SYNC_KEY` in Vercel (Production) and redeploy", and the `APP_URL` example to the Vercel address.

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "feat(db): migrate and load-cheques commands; README for Vercel and Supabase"
git push origin main
```

---

### Task 6: Go live

Needs from the owner first: `.env.production.local` in the project folder with `DATABASE_URL=` (Supabase transaction pooler string) and `ADMIN_PASSWORD=` (the password staff will type). If either is missing, stop and ask.

- [ ] **Step 1: Create the tables and load the cheques in Supabase**

```bash
npm.cmd run migrate
npm.cmd run load-cheques -- data/cheques-import.imported-2026-10-03.json
```
Expected: `001_init.sql` applied; `Loaded 585 cheques …` and the same summary line as in Task 5 Step 2. If the totals differ, stop.

- [ ] **Step 2: Create the Vercel project and its settings**

Read `VERCEL_TOKEN` from `C:\WWJ\Claude Coding\Code\.env.local` into an environment variable without printing it. Then, in the Cheques folder:
```bash
npx.cmd vercel link --yes --project cheque-tracker --scope wwj10 --token "$VERCEL_TOKEN"
```
Generate `SESSION_SECRET` and `SYNC_KEY` (48 random bytes each, base64url) and append them to `.env.production.local` if not already there. Add the four settings to Vercel's Production environment, each read from `.env.production.local` and piped on standard input so no value appears in a command line or in output:
```bash
printf '%s' "$VALUE" | npx.cmd vercel env add NAME production --scope wwj10 --token "$VERCEL_TOKEN"
```

- [ ] **Step 3: Deploy and connect GitHub**

```bash
npx.cmd vercel deploy --prod --scope wwj10 --token "$VERCEL_TOKEN"
npx.cmd vercel git connect https://github.com/jtpepito/cheque-tracker --scope wwj10 --token "$VERCEL_TOKEN"
```
If `git connect` is refused (the Vercel GitHub app may not have access to the new repo), say so; deploys then stay manual until the owner grants access in Vercel.

- [ ] **Step 4: Check the live site**

- `GET /login` → 200; `GET /api/state` without a session → 401; `POST /api/sync` without a key → 401.
- A dry-run sync against the live address with the real `SYNC_KEY` (built from the local import file, as in Task 5): expected `added 0, removed 0, problems 0, changed 98`.
- Ask the owner to sign in and compare Monday 5 Oct and the "Issued, not yet cleared" line with the figures in Task 5 Step 2. (Signing in on the live site with the real password is the owner's to do.)

- [ ] **Step 5: Hand over**

Report the live address, the figures checked, whether auto-deploy is connected, and that `SYNC_KEY` for the sheet script is in `.env.production.local`.
