# Cheque Funding Tracker

How much will clear, from which company, on each of the next 14 days. One shared password.

Designs: `docs/superpowers/specs/` (the tracker, the sheet sync, and hosting on Vercel with Supabase).

## Run locally

```
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3002 and sign in as `owner` with password `admin` until you create an account (see Users). With no `DATABASE_URL`, data is kept in an
in-process Postgres in `data/pglite` (git-ignored). Tests: `npm.cmd test`.

To load cheques into the local database, stop the dev server and run:

```
npm.cmd run load-cheques -- <file.json> --local
```

Real payees and amounts stay out of git: `data/` is ignored.

## Production: Vercel + Supabase

Live at https://cheque-tracker-nine.vercel.app. Data lives in the Supabase project `cheque-tracker`
(Singapore); the site runs on Vercel (project `cheque-tracker`, team `wwj10`, region `sin1`).

A push to `main` on GitHub deploys to production (the repo is connected to the Vercel project). Run
`npm.cmd run migrate` first when a change adds a file to `db/migrations`.

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

Set since 4 Oct 2026: `DATABASE_CA_CERT`, the text of Supabase's CA certificate (Supabase dashboard >
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

## Check vouchers

Every cheque in the register can have one Check Voucher: open it with the **Voucher** button on the
cheque's row (an Unassigned cheque needs a company first). Vouchers are numbered per company in order
of creation (`WWJ-CV-0001`, `WYT-CV-0001`, `WWJC-CV-0001`, five digits after 9999); a number is never reused. The **Vouchers**
link at the top lists them.

The voucher's particulars are filled from the sheet's SI tabs: every invoice whose "Payment Details"
names the cheque number, once the sheet script version that sends the SI rows is installed. Lines can
be added, edited, reordered and removed; the voucher keeps its own copy. **Save and print** saves the
voucher, then opens the browser's print dialog, laid out for one Letter page. A voucher can be deleted while its cheque is still
issued or pending; once the cheque is cleared or voided the voucher is kept.

Each company's address and TIN, printed at the top of its vouchers, are entered under **Edit names**
(`PUT /api/company-details`). Tables: `vouchers`, `voucher_lines`, `voucher_series`, `invoices`
(migration `004_vouchers.sql`).

## Users

Each person signs in with their own username and password. Roles: **Owner** (everything, including the
Users page) and **Staff** (everything else). An Owner adds people under **Users** (name, username, role,
starting password), resets passwords, deactivates and reactivates, and changes roles; everyone can change
their own password from the header. The app refuses to deactivate or demote the last active Owner.

Until an Owner account exists, the shared password () signs in as username .
Creating the first Owner account ends that session at once: sign in again as yourself. After that the
shared password is refused and  can be removed from Vercel (keep ).
Deactivating a person or resetting their password ends their current sessions on their next request.
Ten wrong sign-in attempts in 15 minutes, per address or per username, lock that address or username out
for 15 minutes. Balances, company choices and vouchers record the name of the person who made them.
