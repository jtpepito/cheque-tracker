-- Invoices now also come from each company's DR tab, so a row is known by its tab as well as its
-- row number. Rows sent by an older sheet script have no tab ('').
ALTER TABLE invoices ADD COLUMN tab text NOT NULL DEFAULT '';
ALTER TABLE invoices DROP CONSTRAINT invoices_pkey;
ALTER TABLE invoices ADD PRIMARY KEY (company, tab, row);
