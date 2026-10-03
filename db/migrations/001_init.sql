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
