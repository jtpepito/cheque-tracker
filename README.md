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
