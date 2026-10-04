# Cheque Funding Tracker

How much will clear, from which company, on each of the next 14 days. One shared password.

Designs: `docs/superpowers/specs/` (the tracker, the sheet sync, and hosting on Vercel with Supabase).

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

Real payees and amounts stay out of git: `data/` is ignored.

## Production: Vercel + Supabase

Live at https://cheque-tracker-nine.vercel.app. Data lives in the Supabase project `cheque-tracker`
(Singapore); the site runs on Vercel (project `cheque-tracker`, team `wwj10`, region `sin1`).

Deploying is manual for now: `npx.cmd vercel deploy --prod --scope wwj10` from this folder, signed in to
Vercel. To deploy on every push instead, connect the GitHub repo under the Vercel project's Settings > Git
(Vercel's GitHub app needs access to `jtpepito/cheque-tracker` first).

`DATABASE_URL` must use Supabase's **shared pooler** host (`aws-0-ap-southeast-1.pooler.supabase.com`, user
`postgres.<project ref>`). The `db.<ref>.supabase.co` host is IPv6-only and Vercel cannot reach it.

Secrets are set in Vercel (Production): `ADMIN_PASSWORD`, `SESSION_SECRET`, `SYNC_KEY`, `DATABASE_URL`.
`DATABASE_URL` is the Supabase **transaction pooler** string (port 6543). For the two commands below it
is also kept in `.env.production.local` on this PC, which is git-ignored.

```
npm.cmd run migrate
npm.cmd run load-cheques -- <file.json>
```

`migrate` applies new files from `db/migrations`. `load-cheques` loads by id, all or nothing, keeps
companies chosen by hand, and prints the count and totals by company. Backups are Supabase's daily ones.

The app refuses to run in production without `DATABASE_URL`, so it can never keep data somewhere
that resets.

Optional but recommended: `DATABASE_CA_CERT`, the text of Supabase's CA certificate (Supabase dashboard >
Database settings > SSL configuration > download certificate). With it, the app verifies it is really
talking to Supabase. Without it, the connection is encrypted but the server is not verified. Set it in
Vercel, and in `.env.production.local` with line breaks written as `\n`.

Deploys upload only what `.vercelignore` allows; `data/` and every `.env*` file are excluded.

## Sync from the Google Sheet

Cheques and their status come from the "Check Issuances" tab of the Supplier Invoices Register Log.
A script in the sheet sends the tab to this app within about a minute of an edit. The app never
writes to the sheet; the script writes only its "Tracker ID" column. Design:
`docs/superpowers/specs/2026-10-03-sheet-sync-design.md`.

Set up, once the app is deployed and the cheques are loaded:

1. `SYNC_KEY` must be set in Vercel (Production). It is at least 32 characters; keep it private.
2. **Try it on a copy first.** In Google Sheets: File > Make a copy. In the copy: Extensions > Apps
   Script, paste `sheet-script/Code.gs`, save. Under Project Settings > Script Properties add
   `APP_URL` (the site's https address, with no path) and `SYNC_KEY`. Reload the sheet; a "Cheque tracker"
   menu appears. Run "Give existing rows their IDs (one time)", then "Check against the tracker (no
   changes)". Use only the check on the copy. The check writes nothing, in the sheet or the app.
   ("Sync now" on a copy asks whether to make it the spreadsheet the tracker follows: choose Cancel.)
3. Expect: Removed 0; Added only cheques entered since the cheques were loaded; Changed only where
   the sheet was edited since, or where the company rules differ from the first import.
4. Repeat step 2 in the real sheet, using an account that will keep edit access (the sync runs as
   that account). Run the check again, then "Sync now", then "Turn automatic sync on".
   The first "Sync now" asks to make this the spreadsheet the tracker follows: choose OK. Only that
   spreadsheet can sync; any copy of it can only be checked.

If many rows are deleted on purpose, a sync is refused once it would remove more than 20 cheques;
use "Sync now, allowing removals". Rows the app cannot read are listed on the page under "Sheet rows
to fix" and skipped until corrected.

If a sync is refused, the page says why under the header until the next sync goes through. The one-time
"Give existing rows their IDs" step refuses to run twice; if the "Tracker ID" heading is ever deleted,
put the heading back rather than re-running it.
