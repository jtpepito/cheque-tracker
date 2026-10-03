# Hosting on Vercel with Supabase — Design

Date: 3 Oct 2026
Replaces the hosting parts of `2026-10-03-cheque-tracker-design.md` (Fly.io, SQLite file, backups, startup import). Everything the app does for its users stays the same.

## 1. Goal

Run the tracker on Vercel, with its data in a new Supabase project, because Vercel has no disk that persists. Nothing about the page, the banking-day rule or the sheet sync changes for the people using it.

## 2. Decisions

| Topic | Decision |
|---|---|
| Database | A new Supabase project named `cheque-tracker`, region Singapore, separate from Bake Hub |
| How the app reaches it | A direct Postgres connection from the server only (`DATABASE_URL`, Supabase's transaction pooler, SSL). No Supabase keys in the browser, no Supabase sign-in |
| Public API exposure | Row level security is switched on for every table with no policies, so Supabase's public API can read and write nothing |
| Web host | A new Vercel project `cheque-tracker` in team `wwj10`, functions in region `sin1`, connected to GitHub `jtpepito/cheque-tracker` so a push to `main` deploys |
| Sign-in | Unchanged: one shared password and the signed cookie |
| Tests and local development | An in-process Postgres (PGlite). No network and no test project. `npm.cmd run dev` keeps its data in `data/pglite/` |
| Backups | Supabase's daily backups (Pro plan). The app no longer writes backup files |
| First data load | A command run from this PC that loads `cheques-import.json` into the database |

## 3. The storage layer

One small interface that the rest of the app uses, with two implementations:

```ts
type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs fn in one transaction; rolls back if it throws. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};
```

- **Production:** `pg` connection pool on `DATABASE_URL`.
- **Tests and local development:** PGlite. Tests use a fresh in-memory database each; `npm.cmd run dev` uses `data/pglite/`.
- **Choosing:** `DATABASE_URL` set → `pg`. Not set → PGlite, except on Vercel or in a production build, where a missing `DATABASE_URL` is an error. The app must never run on storage that silently resets.

Every function in `lib/cheques.ts`, `lib/sync.ts` and `lib/import.ts` becomes `async` and takes an `Sql`. Their behaviour and their tests stay the same. The pure modules (`calendar`, `banking`, `register`, `sheet-rows`, `company-rules`, `money`, `dates`, `sync-status`, `session`) are not touched.

## 4. Tables

Defined in `db/migrations/001_init.sql`, applied by `npm.cmd run migrate` to the real database and automatically to PGlite. A `schema_migrations` table records what has been applied.

- `cheques` — the same columns as now. `amount numeric(14,2)` (read back as a number), `created_at bigint`, `imported boolean`, `company_locked boolean`, the same checks on `company` and `status`.
- `config` — `key`, `value` (company names, last sync, last refusal).
- `holidays` — `date`, `name`; the 2026 national holidays are inserted by the migration.
- `login_failures` — `who`, `at`; see §5.

The upgrade step for databases made before the lock column is dropped: the new database starts with the column.

## 5. What changes because of Vercel

- **Sign-in lockout.** The count of wrong passwords moves from memory to the `login_failures` table (10 failures from one address in 15 minutes, as now), because memory is not shared between Vercel's function instances.
- **No startup work.** `instrumentation.ts`, the backup timer and the startup import are removed.
- **A sync is one transaction** on one connection, as now. The first sync into an empty database inserts every cheque; later ones write only what changed.
- **Removed files:** `Dockerfile`, `.dockerignore`, `fly.toml`, `lib/backup.ts`, `lib/throttle.ts` and their tests where they exist.

## 6. Commands

| Command | What it does |
|---|---|
| `npm.cmd run migrate` | Applies new migration files to the database in `DATABASE_URL` |
| `npm.cmd run load-cheques -- <file>` | Loads an import file (same format and rules as now: by id, all or nothing, hand-chosen companies kept) and prints the count and totals by company |

Both read `DATABASE_URL` from `.env.production.local`, which is git-ignored.

## 7. Settings on Vercel (Production)

`ADMIN_PASSWORD`, `SESSION_SECRET`, `SYNC_KEY`, `DATABASE_URL`. None is committed.

## 8. Going live (in order)

1. Owner creates the Supabase project and saves its pooled connection string in `.env.production.local` as `DATABASE_URL`.
2. `npm.cmd run migrate`, then `npm.cmd run load-cheques -- data\cheques-import.imported-2026-10-03.json`. Check the printed totals: 585 cheques, ₱43,403,796.08.
3. Create the Vercel project with the Vercel token already used for Bake Hub, set the four settings, deploy.
4. Sign in on the Vercel address and check the calendar against the local one.
5. Sheet sync setup as in the README, with `APP_URL` set to the Vercel address.

## 9. Errors

- Database unreachable: API routes answer 500 with "Something went wrong. Try again."; the page keeps the last data and shows its refresh warning; a sync is retried by the sheet.
- `DATABASE_URL` missing in production: every request fails loudly with a clear server log line; nothing is stored anywhere else.

## 10. Testing

- The existing store, import and sync tests run unchanged in meaning against PGlite.
- New tests: the migration creates every table and the holiday seed; the sign-in lockout counts, expires and resets through the database; the storage chooser refuses to start in production without `DATABASE_URL`.
- After deploying: sign in, compare the calendar and the "Issued, not yet cleared" figures with the local app, and run a dry-run sync against the live address.

## 11. Not included

- Supabase sign-in, user accounts or roles.
- Moving Bake Hub anything.
- The Fly.io route. Its files are deleted; the earlier design doc keeps the description.
