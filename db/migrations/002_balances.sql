-- Each trading company's bank balance, as last typed in by someone who checked the bank.
CREATE TABLE balances (
  company    text PRIMARY KEY CHECK (company IN ('wwj','wythlae','wwjcorp')),
  amount     numeric(14,2) NOT NULL,
  updated_at bigint NOT NULL
);

ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
