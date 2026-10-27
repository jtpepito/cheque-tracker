# Check Vouchers — Design (Phase 1: printable vouchers)

Date: 27 Oct 2026
Builds on: `2026-10-03-cheque-tracker-design.md`, `2026-10-03-sheet-sync-design.md`

## 1. Goal

A numbered, printable Check Voucher for any cheque in the tracker, listing the invoices the cheque pays, with lines for the people who prepared, checked, approved and received it. Phase 1 covers cheques that already exist in the sheet. Phase 2 (approval before the cheque is written) and phase 3 (accounting lines and export) come later and are not designed here.

## 2. Decisions

| Topic | Decision |
|---|---|
| Who did what | The app keeps its one shared password. Names are typed on the voucher; the control is the signature on paper. |
| One voucher per cheque | A cheque has at most one voucher. Making a second opens the first. |
| Companies | A voucher needs a company. An Unassigned cheque must be given one first (the existing dropdown). |
| Numbering | One series per company, by creation order, four digits: `WWJ-CV-0001`, `WYT-CV-0001`, `WWJC-CV-0001`. A number is never reused, even after a delete. |
| Particulars | Filled from the sheet's SI tabs by cheque number, then editable. The voucher keeps its own copy of the lines. |
| Print | Browser printing of a page laid out for A4 portrait, one voucher per page. No PDF library. |
| Deleting | Allowed while the cheque is still issued or pending; a voucher for a cleared or voided cheque is kept. |

## 3. Data

### `vouchers`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | random |
| `number` | text, unique | e.g. `WWJ-CV-0012` |
| `company` | text | `wwj`, `wythlae`, `wwjcorp` (same CHECK as balances) |
| `cheque_id` | text, unique, references `cheques(id)` ON DELETE SET NULL | the cheque it pays; null only if the cheque was later removed from the sheet |
| `voucher_date` | text `YYYY-MM-DD` | defaults to the day it is made (Manila) |
| `payee` | text | copied from the cheque, editable |
| `amount` | numeric(14,2) | copied from the cheque, editable |
| `prepared_by`, `checked_by`, `approved_by`, `received_by` | text, default '' | typed names |
| `notes` | text, default '' | free text printed under the particulars |
| `created_at`, `updated_at` | bigint | |

### `voucher_lines`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `voucher_id` | text, references `vouchers(id)` ON DELETE CASCADE | |
| `position` | integer | print order |
| `invoice_no` | text | |
| `invoice_date` | text, may be '' | `YYYY-MM-DD` |
| `description` | text | supplier or what was bought |
| `gross` | numeric(14,2), nullable | |
| `ewt` | numeric(14,2), nullable | |
| `net` | numeric(14,2), nullable | |

### `voucher_series`
`company` text PK, `last_number` integer. The next number is `last_number + 1`, taken inside the same transaction that inserts the voucher, so two people making vouchers at once get different numbers.

### `invoices` (a copy of the SI tabs, replaced on every sync)
| Column | Type | Notes |
|---|---|---|
| `company` | text | which company's SI tab |
| `row` | integer | row in that tab |
| `invoice_date` | text | as sent, may be '' |
| `invoice_no` | text | |
| `supplier` | text | |
| `gross` | numeric(14,2), nullable | "Total Purchases" |
| `payment_details` | text | free text that names the cheque |
| `ewt` | numeric(14,2), nullable | "EWT Amount" |
| `net` | numeric(14,2), nullable | "Amt Payable (Net of EWT)" |
| primary key (`company`, `row`) | | |

### `config` additions
`company_details`: `{ wwj: { address, tin }, wythlae: {…}, wwjcorp: {…} }`, edited on the page next to the company names.

## 4. Matching invoices to a cheque

An invoice row belongs to a cheque when the cheque's number (its digits, 5 or more) appears as a whole number in the row's Payment Details, using the same rule as the company cross-reference (`lib/company-rules.ts`: not part of a longer number, not the start of an amount). Only rows from the cheque's own company's SI tab are considered. Rows are offered in sheet order. A cheque with no number matches nothing.

When a voucher is made, the matching invoices become its lines: invoice number, date, supplier as the description, gross, EWT, net. If the sum of the lines' net differs from the cheque amount, the voucher page says so, but nothing stops printing: staff decide.

## 5. The sync

The script in the sheet already reads each SI tab's Payment Details column. It will instead send the whole tab, one object per row, with these columns found by header name: the date column (`Invoice Date` or `Date`), `Supplier Inv. No.`, `Supplier`, `Total Purchases`, `Payment Details`, `EWT Amount`, `Amt Payable (Net of EWT)`. A missing header stops the sync with a message naming it, as now. Blank rows (no supplier, no invoice number, no gross) are skipped.

`POST /api/sync` accepts `invoices: { wwj: [...], wythlae: [...], wwjcorp: [...] }` alongside `siRefs`, and replaces the `invoices` table in the same transaction. The company rules keep using `siRefs` as today. An older script that sends no `invoices` still works; the table is then left as it was.

Amounts and dates are read with the same rules as cheque rows (`lib/sheet-rows.ts`); an unreadable amount becomes null rather than failing the sync, because invoice rows only feed suggestions.

## 6. Pages and routes

- **Register:** a **Voucher** button on each row. If the cheque has a voucher it opens it; otherwise it makes one and opens it. On an Unassigned cheque the button is disabled with "Choose a company first".
- **`/vouchers`:** the list, newest first: number, voucher date, payee, amount, company, cheque number. A search box filters by payee, cheque number or voucher number. Links to each voucher.
- **`/vouchers/[id]`:** the voucher. Editable: voucher date, payee, amount, the four names, notes, and the lines (add, edit, remove, reorder by position). Buttons: **Save**, **Print**, **Delete** (when allowed), **Back to register**. The page shows the cheque's number, bank account, cheque date and status from the tracker, read-only.
- **Print layout:** `@media print` hides everything but the voucher, A4 portrait, one page. The page shows a preview that looks like the print.
- Routes (all behind the session): `GET /api/vouchers`, `POST /api/vouchers` `{ chequeId }`, `GET /api/vouchers/:id`, `PUT /api/vouchers/:id`, `DELETE /api/vouchers/:id`, `GET /api/invoices?chequeId=` (the matching rows, for the "Fill from sheet" button), `PUT /api/company-details`.

## 7. Amount in words

Philippine peso style, capitals: `ONE HUNDRED SIX THOUSAND FOUR HUNDRED ONE PESOS AND 43/100`; `ONE PESO AND 00/100`; `ZERO PESOS AND 50/100`. Up to 999,999,999,999.99. Pure function, tested.

## 8. Errors

- Making a voucher for a cheque that already has one: opens the existing voucher (no error).
- Making a voucher for an Unassigned cheque: 400 "Choose a company for this cheque first."
- Deleting a voucher for a cleared or voided cheque: 409 "This cheque has been paid; its voucher is kept."
- Saving with an amount that is not a number, or a line amount that is not a number: 400 naming the field; nothing saved.
- The cheque behind a voucher disappears from the sheet: the voucher stays, its cheque details show "cheque no longer in the sheet".

## 9. Testing

- Unit: amount in words; the number series (per company, no reuse, two at once); invoice matching (whole number, own company only, no number); creating a voucher fills lines from invoices; saving and loading; delete rules; the sync replacing the invoices table and accepting a payload without `invoices`.
- Browser, before going live: make a voucher from the register, check the filled lines, print preview on A4, the list and its search, and the phone layout of the voucher page.
- The script change is tried on a copy of the sheet first, with the check-only menu item, as before.

## 10. Going live (in order)

1. `npm.cmd run migrate` against production (new tables only; nothing existing changes).
2. Push to `main` (deploys).
3. Paste the updated `sheet-script/Code.gs` into the sheet's Apps Script and save (settings and triggers are unchanged). Until this is done, vouchers can be made but their lines must be typed by hand.
4. Enter each company's address under Edit names.

## 11. Later phases (not designed here)

- **Phase 2, approval before payment:** vouchers without a cheque yet, a status (draft, checked, approved, paid), matching to the cheque when it appears in the sheet, and a list of what is waiting. Needs a decision on user accounts.
- **Phase 3, accounting:** a chart of accounts, debit and credit lines per voucher that must balance, VAT and EWT handling, export for the books.
