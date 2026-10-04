-- When the tracker last saw a cheque's status change. Used to tell which cheques were marked
-- cleared after a bank balance was typed in: that balance may still include their money.
ALTER TABLE cheques ADD COLUMN status_changed_at bigint;
