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
