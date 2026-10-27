-- Check vouchers (phase 1): one printable voucher per cheque, with invoice lines.

-- A copy of each company's SI tab from the sheet, replaced on every sync. Used only to suggest
-- a voucher's lines; the voucher keeps its own copy.
CREATE TABLE invoices (
  company         text NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp')),
  row             integer NOT NULL,
  invoice_date    text NOT NULL DEFAULT '',
  invoice_no      text NOT NULL DEFAULT '',
  supplier        text NOT NULL DEFAULT '',
  gross           numeric(14,2),
  payment_details text NOT NULL DEFAULT '',
  ewt             numeric(14,2),
  net             numeric(14,2),
  PRIMARY KEY (company, row)
);

-- The last voucher number given out per company. Numbers are never reused.
CREATE TABLE voucher_series (
  company     text PRIMARY KEY CHECK (company IN ('wwj','wythlae','wwjcorp')),
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE vouchers (
  id           text PRIMARY KEY,
  number       text NOT NULL UNIQUE,
  company      text NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp')),
  cheque_id    text UNIQUE REFERENCES cheques(id) ON DELETE SET NULL,
  voucher_date text NOT NULL,
  payee        text NOT NULL DEFAULT '',
  amount       numeric(14,2) NOT NULL,
  prepared_by  text NOT NULL DEFAULT '',
  checked_by   text NOT NULL DEFAULT '',
  approved_by  text NOT NULL DEFAULT '',
  received_by  text NOT NULL DEFAULT '',
  notes        text NOT NULL DEFAULT '',
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);

CREATE TABLE voucher_lines (
  id           text PRIMARY KEY,
  voucher_id   text NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  invoice_no   text NOT NULL DEFAULT '',
  invoice_date text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  gross        numeric(14,2),
  ewt          numeric(14,2),
  net          numeric(14,2)
);
CREATE INDEX voucher_lines_voucher ON voucher_lines (voucher_id, position);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
