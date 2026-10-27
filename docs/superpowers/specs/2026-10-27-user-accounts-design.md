# User Accounts — Design

Date: 27 Oct 2026
Builds on: `2026-10-03-cheque-tracker-design.md` (sign-in), `2026-10-27-check-vouchers-design.md` (phase 2 needs to know who approves)

## 1. Goal

Each person signs in as themselves, with a role, so the app can say who entered a balance, who assigned a company, who made a voucher, and later who approved one. The single shared password is retired once the owner has an account.

## 2. Decisions

| Topic | Decision |
|---|---|
| Identity | Username and password per person, managed inside the app by an Owner. No email, no Google sign-in, no two-factor. |
| Roles | `owner` (everything, including Users) and `staff` (everything else). A per-person `can_approve` flag is stored now, unused until voucher phase 2. |
| Shared password | `ADMIN_PASSWORD` signs in as a temporary Owner only while no active Owner account exists. After that it is refused. |
| Passwords | Scrypt hashes (Node's `crypto.scrypt`, random 16-byte salt, N=16384). Minimum 8 characters. Starting passwords are set by an Owner and told to the person; anyone can change their own. |
| Sessions | The signed cookie carries the user id and the user's `session_version`. API routes look the user up on every request; deactivating a user or resetting their password bumps `session_version`, so their existing sessions stop working within one request. |
| Lockout | Ten wrong attempts in 15 minutes per address (as now) **or** per username. |
| Audit | `balances.updated_by`, `cheques.company_set_by`, `vouchers.created_by` and `updated_by` hold the user's name at the time. Nothing is deleted when a user is deactivated. |

Rejected: Supabase Auth with email invitations (more setup, email dependency; can be added later), keeping the shared password as a permanent back door (defeats the audit trail).

## 3. Data

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | random |
| `username` | text, unique, case-insensitive | 3–30 characters: letters, digits, `.`, `_`, `-` |
| `name` | text | shown on the page and printed on vouchers |
| `role` | text | `owner` or `staff` |
| `can_approve` | boolean, default false | reserved for voucher phase 2 |
| `password_hash` | text | `scrypt$<salt hex>$<hash hex>` |
| `active` | boolean, default true | |
| `session_version` | integer, default 1 | bumped on deactivate and password reset |
| `created_at`, `updated_at` | bigint | |

### `login_failures`
Gains nothing; the `who` column already holds an arbitrary key. Attempts are recorded under both `ip:<address>` and `user:<username>`.

### Audit columns (nullable text, the user's name): `balances.updated_by`, `cheques.company_set_by`, `vouchers.created_by`, `vouchers.updated_by`.

## 4. Signing in

- The sign-in page asks for username and password.
- Order of checks: lockout (address, then username) → if an active Owner exists, the username must match an active user and the password its hash; otherwise, the username must be `owner` and the password `ADMIN_PASSWORD` (the temporary Owner, id `shared`, name "Owner (shared password)").
- Wrong password: "Wrong username or password." Deactivated user: the same message. Locked out: "Too many wrong passwords. Try again in 15 minutes."
- The cookie value is `<expiry>.<user id>.<session version>.<hmac>`; `verifySessionToken` returns `{ userId, version }` or null. Middleware checks the signature and expiry only (no database at the edge). `guarded()` in API routes additionally loads the user and refuses with 401 when the user is missing, inactive, or the version differs. The `shared` id is accepted only while no active Owner exists.
- 12-hour sessions, as now.

## 5. What each role can do

| Action | Staff | Owner |
|---|---|---|
| See everything, assign companies, enter balances, holidays, company names and details | yes | yes |
| Make, edit, print, delete vouchers | yes | yes |
| Users page: add, deactivate, reactivate, reset password, change role | no | yes |
| Change own password | yes | yes |

An Owner cannot deactivate or demote themselves if they are the last active Owner (409 "There must be at least one active Owner.").

## 6. Pages and routes

- **Sign-in page:** username and password fields. Below them, until an Owner account exists: "First time: sign in with username `owner` and the shared password, then create your own account under Users."
- **Header:** shows the signed-in person's name; a **Users** link for Owners; **Change password** for everyone (a small form: current password, new password twice).
- **`/users`** (Owners only; Staff get a plain "Owners only" page): a table of users with name, username, role, active, created; **Add user** (name, username, role, starting password); per row: **Reset password**, **Deactivate** / **Reactivate**, **Make Owner** / **Make Staff**.
- **Routes:** `GET /api/me`; `PUT /api/me/password` `{ current, next }`; Owners only: `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` `{ role? , active? }`, `POST /api/users/:id/password` `{ next }`. All 403 for Staff.
- **Audit on existing routes:** `PUT /api/balances` records `updated_by`; `PATCH /api/cheques/:id` records `company_set_by`; `POST /api/vouchers` sets `created_by` and pre-fills `prepared_by` with the user's name; `PUT /api/vouchers/:id` sets `updated_by`. The Bank balances section shows "entered 27 Oct, 3:10 PM by Ana". The voucher page shows "Made by Ana · last saved by Ben".

## 7. Errors

- Username taken: 409 "That username is already used."
- Username or password that does not meet the rules: 400 naming the field.
- Last Owner: 409 as in §5.
- A request from a session whose user was deactivated: 401; the page sends them to sign-in.
- `ADMIN_PASSWORD` unset and no Owner exists: the sign-in page explains that the shared password must be set to create the first account.

## 8. Going live (in order)

1. `npm.cmd run migrate` against production (new table and columns; existing data untouched).
2. Push to `main` (deploys). Everyone currently signed in is signed out, because the cookie format changes.
3. The owner signs in as `owner` with the shared password, creates their Owner account under Users, signs out, and signs in as themselves. The shared password then stops working.
4. The owner creates the staff accounts and tells each person their starting password.
5. Optional: remove `ADMIN_PASSWORD` from Vercel later. (Keep `SESSION_SECRET`.)

## 9. Testing

- Unit: password hashing and checking; username rules; the sign-in decision (shared password only while no Owner, wrong password, inactive user, lockout per username); session tokens carrying id and version, and rejection on a version bump; the last-Owner rule; adding, deactivating, resetting; the audit columns being filled.
- Browser, before going live: sign in with the shared password, create an Owner, confirm the shared password is refused, create a Staff user, confirm Staff cannot open Users, change a password, deactivate a user and confirm their session dies.

## 10. Not included

- Email, Google sign-in, two-factor, password rules beyond length, self-service password reset.
- Approval steps (voucher phase 2).
- Per-company permissions.
