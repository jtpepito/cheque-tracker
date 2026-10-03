# Live Sync from the Google Sheet — Design

Date: 3 Oct 2026
Builds on: `2026-10-03-cheque-tracker-design.md`
Sheet: "Supplier Invoices Register Log 2026", tab **Check Issuances** (owner `wtimbal11@gmail.com`, shared with the app's owner)

## 1. Goal

Staff keep working only in the Google Sheet. Within about a minute of an edit, the tracker shows the same cheques and statuses, so the funding calendar is always current without anyone entering a cheque twice.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where status is changed | Only in the sheet. The app's Mark issued, Mark cleared and Void buttons are removed. |
| Where cheques are entered | Only in the sheet. The app's New cheque form is removed. |
| How rows are matched | A "Tracker ID" column in the sheet, filled in by the script. Never by row number. |
| Company | Worked out from the sheet by the three import rules; a company chosen by hand in the app is locked and never overwritten. |
| Direction | Sheet → app. The app writes nothing to the sheet. The script writes only the Tracker ID column. |
| Mechanism | A Google Apps Script bound to the sheet posts the tab to the app. No Google Cloud project. |

Rejected: the app reading the sheet through Google's API on a schedule (needs a service account and a key on Fly.io); matching by row number (breaks when rows are sorted, inserted or deleted); matching by cheque number and date (some rows have no cheque number).

## 3. The sheet

Check Issuances columns, in order: Date, Name of Supplier, Check Number, Amount, Cheque Date, Check Status, CR No./ SI No. The script finds columns by these header names, not by position, so a moved column does not break the sync. A missing header stops the sync with a message naming it.

The script adds one column at the far right, headed **Tracker ID**. It may be hidden. Staff never type in it.

- A row counts as a cheque when it has a supplier, a cheque number or an amount. Fully blank rows are ignored and get no ID.
- Existing rows: a one-time "Give existing rows their IDs" step writes `imp-{row number}` (the ids the app already holds from the original import).
- Later rows: the script writes `sh-` plus 10 random letters and digits to any cheque row whose Tracker ID is blank.
- Two rows with the same Tracker ID (a copied row): the script blanks the lower one and gives it a new ID.

Company SI tabs: each company has an SI tab with a "Payment Details" column that lists cheque numbers. The tab name for each company is set at the top of the script.

## 4. The script (`sheet-script/Code.gs` in the repo)

Kept thin: read, fill IDs, send. Every rule about what a row means lives in the app.

**What it sends** — `POST {APP_URL}/api/sync` with header `Authorization: Bearer {SYNC_KEY}`:

```json
{
  "dryRun": false,
  "allowRemovals": false,
  "rows": [
    { "id": "imp-2", "row": 2, "date": "2024-08-20", "supplier": "…", "chequeNo": "590417",
      "amount": 16882.63, "chequeDate": "2025-12-10", "status": "Cleared", "reference": "" }
  ],
  "siRefs": { "wwj": "…Payment Details text of the WWJ SI tab…", "wythlae": "…", "wwjcorp": "…" }
}
```

- Date cells are sent as `YYYY-MM-DD` in the spreadsheet's time zone. A date typed as text is sent as the text shown.
- Amount cells are sent as numbers; an amount typed as text is sent as the text shown.
- Cheque numbers are sent as the text shown, so `0012` keeps its zeros.

**When it runs**
- An edit to Check Issuances or an SI tab sets a "changed" flag.
- A one-minute timer sends when the flag is set, then clears it.
- An hourly timer sends regardless.
- If the app refuses or cannot be reached, the flag stays set and the next minute tries again.

**Menu "Cheque tracker"** in the sheet:
- *Check against the tracker (no changes)* — a dry run; shows the app's report.
- *Sync now*
- *Sync now, allowing removals* — for when many rows were deleted on purpose.
- *Give existing rows their IDs* — one time.
- *Turn automatic sync on / off* — installs or removes the timers.

**Settings** (Script Properties): `APP_URL`, `SYNC_KEY`.

## 5. The app

### 5.1 `POST /api/sync`
- Not behind the sign-in cookie; it checks the bearer key against the `SYNC_KEY` secret with a constant-time compare.
- `SYNC_KEY` unset or shorter than 32 characters: every request gets 503 "Sync is not set up." Wrong key: 401.
- Body larger than 5 MB, or not the shape in §4: 400.
- One sync is applied in a single database transaction: all of it or none of it.

### 5.2 Reading a row
| Field | Rule |
|---|---|
| `id` | Required. A row without one is a problem row. |
| Cheque date | `YYYY-MM-DD`, or `M/D/YY` / `M/D/YYYY` text. Blank is kept as "No date". Anything else is a problem row. |
| Date logged | Same formats; blank or unreadable becomes none. |
| Amount | A number, or text like `₱16,882.63`. Blank is kept as no amount. Negative or unreadable is a problem row. |
| Cheque number | Text as shown; a trailing `.0` on an all-digit number is dropped. May be blank. |
| Status | Cleared / Encashed → `cleared`; Released to Supplier → `issued`; Cancelled / Returned / Replaced → `voided`; With Christine → `pending`; anything else, including blank → `issued`. Case and surrounding spaces are ignored. |
| Supplier, reference | Text, trimmed. |

### 5.3 Company
For a cheque whose company is **not locked**, on every sync:
1. Company name in the cheque number (e.g. "WWJ 653507")
2. Company name in the supplier (e.g. "SBC - Wythlae 2 CBC")
3. Cheque number found in a company's SI tab text
4. Otherwise Unassigned

"WWJ Corp" is tested before "WWJ". The basis is stored in `company_basis` as now.

Choosing a company from the app's dropdown sets `company_locked` on that cheque. A locked cheque's company is never changed by a sync. (Unlocking is not offered; choose the right company instead.)

### 5.4 Applying a sync
- **New id:** insert.
- **Known id:** the sheet wins for supplier, cheque number, amount, cheque date, date logged, reference and status. Status may move in any direction, since the sheet is the only place it is set.
- **Id in the app but not in the sheet:** remove, but only cheques that came from the sheet (`imported`). If a sync would remove more than 20 cheques and `allowRemovals` is not set, the whole sync is refused with 409 and a message giving the count.
- **Problem rows** are skipped; the rest of the sync still applies. A known cheque whose row has become a problem row keeps its last good values and is not removed.
- **Duplicate ids in one sync:** the first is used; the others are problem rows.
- **Zero cheque rows in the sync:** refused with 400 (a blank or wrong tab), whatever `allowRemovals` says.

### 5.5 Dry run
`dryRun: true` does everything in §5.2–5.4 and then rolls back. The response is the same report, so the first run can confirm that the Tracker IDs landed on the right rows before anything changes.

### 5.6 The report
Returned to the script and stored as the last sync:

```json
{ "at": 1759500000000, "dryRun": false, "rows": 587, "added": 2, "changed": 5, "removed": 0, "unchanged": 580,
  "problems": [ { "row": 412, "id": "sh-a1b2c3d4e5", "reason": "Cheque date \"13/45/26\" is not a date." } ] }
```

Only a real (not dry) sync replaces the stored report. `/api/state` returns it as `sync`.

### 5.7 The page
- **Removed:** the status buttons, the New cheque form, and their routes (`POST /api/cheques`, status in `PATCH /api/cheques/:id`). The company dropdown stays.
- **Sync line** under the header: "Synced from the sheet 2 minutes ago · 587 cheques". If the last sync is more than 90 minutes old, it becomes a warning: "No update from the sheet since 3 Oct, 2:15 PM. The calendar may be out of date." Before the first sync: "Not yet connected to the sheet."
- **Sheet rows to fix:** when the last sync has problem rows, a box lists each with its sheet row number and reason.
- A locked company shows a small "set here" note beside the dropdown.

### 5.8 Data changes
- `cheques.company_locked` INTEGER NOT NULL DEFAULT 0 (added to existing databases on start).
- `config` key `last_sync`: the report in §5.6.
- The startup import of `cheques-import.json` stays, for the first load.

## 6. Going live (in order)

1. Deploy the app to Fly.io and load the cheques, as in the README.
2. Set the `SYNC_KEY` secret on Fly.io (a long random value).
3. Test the script on a **copy** of the sheet pointed at the app with dry runs only.
4. In the real sheet, someone with edit access pastes the script, sets `APP_URL` and `SYNC_KEY`, and approves it. The sync then runs under that Google account, so it should be an account that will keep its access to the sheet.
5. Run *Give existing rows their IDs*, then *Check against the tracker (no changes)*. Expect no removals, no additions beyond cheques entered since the original import, and changes only where the sheet was edited since.
6. Run *Sync now*, then *Turn automatic sync on*.

## 7. Errors

- App unreachable or returns an error: the script keeps the "changed" flag and retries each minute; the page's sync line turns into the 90-minute warning if this lasts.
- A header renamed or removed in the sheet: the script stops and the menu's dialog names the header; no partial data is sent.
- Anything the app refuses (bad key, too many removals, empty tab): nothing is changed; the reason is returned to the script and shown in the menu dialog and the script's log.

## 8. Testing

- Unit tests, with made-up data: reading rows (both date formats, amounts as number and as text, blank and unreadable values, the `.0` cheque number), status mapping, the three company rules and their order, the company lock, insert / update / remove, the 20-removal guard and its override, problem rows not blocking the rest and not removing a known cheque, duplicate ids, the empty-sync refusal, dry run changing nothing, and the key check.
- The script is exercised against a copy of the sheet (step 3 above) before the real one.

## 9. Not included

- Writing anything to the sheet except the Tracker ID column.
- Syncing other tabs, or the other "next phase" items (bank balances, editing, export).
- Unlocking a hand-chosen company.
