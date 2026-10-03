# Cheque Funding Tracker — Standalone App Design

Date: 3 Oct 2026
Source spec: `spec-cheque tracker.md` (v1 of the claude.ai page, live at https://claude.ai/artifact/LP8BmmaYeKPAwYT5vSipWS)

## 1. Goal

Rebuild the existing cheque tracker page as a self-hosted web app with its own database and a password, so staff use a normal web address instead of a claude.ai link. Features match v1 of the page. The 585 imported cheques carry over.

The app answers one question first: **how much will clear, from which company, on each of the next few days?**

## 2. Decisions

| Topic | Decision |
|---|---|
| Stack | Next.js 15, `node:sqlite`, same as the HRIS app |
| Folder | `C:\WWJ\Claude Coding\Cheques` |
| GitHub | Private repo `jtpepito/cheque-tracker`, branch `main` |
| Hosting | Fly.io app `wwj-cheques`, region `sin`, 1 GB volume mounted at `/data` |
| Access | One shared password (`ADMIN_PASSWORD`), signed session cookie (`SESSION_SECRET`). Everyone signed in can do everything. |
| Live updates | The page re-fetches every 30 seconds and immediately after the user's own changes |
| `pending` in calendar | Not counted. Only `issued` cheques count (source spec open item 6 unchanged) |

Rejected alternatives: Supabase as in Bake Hub (a second service for one small table), and a section inside the HRIS (payroll and payables would share a password).

## 3. Data

SQLite file at `/data/cheques.db` in production and `data/cheques.db` locally (git-ignored).

### `cheques`
| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | `imp-{sourceRow}` for imported rows, a random id for new ones |
| `company` | text | `wythlae`, `wwj`, `wwjcorp` or `unassigned`. Required |
| `cheque_no` | text | Required. Can be text, e.g. `WWJ682068` |
| `payee` | text | Required |
| `amount` | real, nullable | PHP. Required and > 0 for new entries. Two imported rows are blank |
| `issue_date` | text `YYYY-MM-DD` | The cheque date. Drives the calendar |
| `encoded_date` | text, nullable | Date logged. Imported rows only |
| `bank_account` | text | Optional |
| `particulars` | text | CR / SI / DR reference |
| `status` | text | `pending`, `issued`, `cleared` or `voided` |
| `created_at` | integer | Epoch ms |
| `imported` | integer (0/1) | |
| `company_basis` | text, nullable | Imported rows only |
| `source_row` | integer, nullable | Imported rows only |

### `config`
Key and value. One key, `companies`, holding JSON: `{ "wwj": "WWJ Trading", "wythlae": "Wythlae 1220", "wwjcorp": "WWJ Corp" }`. These display names are used everywhere in the page.

### Backups
Once a day (checked at startup and then hourly), the app copies the database to `/data/backups/` and keeps the last 30 copies.

## 4. Structure

| Unit | Purpose |
|---|---|
| `lib/db` | Opens the database, creates the tables, runs the daily backup |
| `lib/cheques` | Reads and writes cheques: list, create, change status, change company |
| `lib/calendar` | Pure functions: the 14 day totals split by company, and the list of days due within 2 days |
| `lib/validate` | Pure function: checks a new cheque |
| `lib/auth` | Password check and session cookie |
| `app/login` | Sign-in page |
| `app/page` | The single tracker page: header, calendar, register, new cheque form |
| `app/api/*` | JSON routes the page calls: cheques (list, create), cheque status, cheque company, company names |
| `lib/import` | At startup, loads a `cheques-import.json` file found next to the database, then renames it |

"Today" is always the date in Manila (Asia/Manila), on the server and in the page.

## 5. Screens

One page behind the sign-in.

### 5.1 Header
App title, the three company names (click to edit; saved for everyone), light/dark switch, sign out.

### 5.2 Funding calendar
- 14 day cards starting today. Each shows the total clearing that day, split by company including Unassigned.
- Only `issued` cheques count, by `issue_date`.
- Cards for today through day +2 with money clearing are highlighted.
- A banner lists them: "Fund the bank account before these clear: …". If there are none: "Nothing clearing in the next 2 days."

### 5.3 Register
- Columns: cheque date (with the logged date underneath when it differs), company dropdown, cheque no., payee (with particulars and bank account), amount, status, actions.
- Sorted by cheque date, then cheque no.
- Filters: company, status, and **Hide cleared & voided** (on by default).
- Summary line: "Issued, not yet cleared: ₱X across N cheques."
- Review banner: count and total of Unassigned cheques that are still pending or issued. Unassigned rows are tinted amber.

### 5.4 Row actions
- `pending`: **Mark issued**
- `issued`: **Mark cleared**, **Void**
- Any row: change the company from the dropdown

No other transitions are allowed. The server rejects them.

### 5.5 New cheque form
Company, cheque no., payee, amount, cheque date (defaults to today), bank account, particulars, status (`issued` or `pending`). Cheque no., payee, date and a positive amount are required. Errors show beside the form and nothing is saved until they are fixed. A cheque is rejected as a duplicate when the same company already has that cheque no. on a cheque that is not voided.

### 5.6 Look
Mint green and purple, light and dark modes, usable on a phone. Fonts are self-hosted (Google Fonts fails behind the office HTTPS inspection).

## 6. Moving the 585 cheques

1. Export every cheque and the company names from the live claude.ai page's database as it stands on the day of the move, so status and company changes made since the original import come along. Cheques added by hand in the page come along too, with their existing ids.
2. Save the export to `data/cheques-import.json`. This path is git-ignored. Real payees and amounts never go to GitHub.
3. When the app starts and finds that file next to its database, it inserts or replaces by `id`, so loading the same file twice never duplicates rows. It then renames the file so it is not loaded again. If any row is unusable, nothing is loaded and the log names the row.
4. After loading, the server log prints the count and per-company totals. Compare them with the source spec §7 (585 cheques, PHP 43,403,796.08), allowing for edits made since the import.
5. On Fly.io: upload the file to `/data/cheques-import.json` and restart the app. The Docker image carries no scripts, which is why the app loads the file itself.

After the move, the claude.ai page is no longer the place to enter cheques. Retiring it is the owner's call.

## 7. Errors

- Wrong password: the sign-in page says so and stays put.
- No session: pages redirect to sign-in; API routes return 401.
- A failed save (network or validation): the row or form shows the error and the page keeps the previous value.
- A failed background refresh: the page keeps showing the last data and tries again on the next cycle.

## 8. Testing

- Unit tests for `lib/calendar`: which cheques count, on which day, company split, the 2-day alert, Manila date boundaries.
- Unit tests for `lib/validate` and the status transition rules.
- Tests for `lib/cheques` against a temporary database, including the import being repeatable.
- One browser run-through before deploying: sign in, add a cheque, mark it issued and cleared, change a company, rename a company.
- Tests use made-up payees and amounts only.

## 9. Deploying

The repo carries a `Dockerfile` and `fly.toml`. The owner runs the `flyctl` commands (create the app and volume, set `ADMIN_PASSWORD` and `SESSION_SECRET`, deploy with `--ha=false --remote-only --depot=false`, upload the export, run the import). Local commands use `npm.cmd`.

## 10. Not included

- Bank balances and shortfall warnings
- Sync from the Google Sheet
- Editing a cheque's details, undoing a status change, change log
- Suggesting a company per payee
- Excel export
- User accounts and roles
- The local-storage fallback from the page (the app always has its database)

## 11. Banking days (added 3 Oct 2026)

This replaces "by cheque date" in §5.2: the calendar counts each issued cheque on its **clearing day**.

- **Clearing day:** the cheque date, or the next banking day when that date is a Saturday, a Sunday or a holiday. A cheque dated before today is counted if its clearing day is today or later.
- **Calendar:** weekend and holiday cards stay in the 14-day strip and read "No clearing" with the reason.
- **Alert window:** today through day +2, stretched to the next banking day when day +2 has no clearing (on a Friday it reaches Monday).
- **Register:** the cheque date column and the sort are unchanged. A pending or issued cheque whose clearing day differs shows "Clears Mon, 5 Oct" under its date.
- **Holidays:** a `holidays` table (`date`, `name`), seeded once with the 2026 national holidays. The page's "Bank holidays" section lets anyone signed in add or remove a day; the list is shared. Local holidays, Eid holidays and later years are added there.
- **Routes:** `POST /api/holidays`, `DELETE /api/holidays/:date`; `/api/state` also returns `holidays`.
