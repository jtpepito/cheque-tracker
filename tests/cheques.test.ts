import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  ChequeError,
  getCompanyNames,
  listCheques,
  removeCheque,
  setCompany,
  setCompanyNames,
  upsertCheque,
} from "@/lib/cheques";
import { openDatabase } from "@/lib/db";
import { cheque } from "./helpers";

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("cheques store", () => {
  it("saves and lists a cheque with every field", () => {
    const c = cheque({ chequeNo: "0012", encodedDate: "2026-09-28", companyBasis: "none", sourceRow: 7, imported: true });
    upsertCheque(db, c);
    expect(listCheques(db)).toEqual([c]);
  });

  it("replaces the cheque with the same id", () => {
    const c = cheque({ amount: 10 });
    upsertCheque(db, c);
    upsertCheque(db, { ...c, amount: 20, status: "cleared" });
    expect(listCheques(db)).toEqual([{ ...c, amount: 20, status: "cleared" }]);
  });

  it("locks the company when it is chosen by hand", () => {
    const c = cheque({ company: "unassigned", companyBasis: "none" });
    upsertCheque(db, c);
    expect(setCompany(db, c.id, "wwjcorp")).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
    expect(listCheques(db)[0]).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
  });

  it("reports an unknown id", () => {
    try {
      setCompany(db, "nope", "wwj");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChequeError);
      expect((e as ChequeError).code).toBe("not_found");
    }
  });

  it("removes a cheque", () => {
    const c = cheque();
    upsertCheque(db, c);
    removeCheque(db, c.id);
    expect(listCheques(db)).toEqual([]);
  });

  it("starts with the default company names and saves new ones", () => {
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
    setCompanyNames(db, { wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
  });

  it("adds the lock column to a database made before it existed, keeping its cheques", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cheques-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE cheques (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, cheque_no TEXT NOT NULL, payee TEXT NOT NULL, amount REAL,
      issue_date TEXT NOT NULL, encoded_date TEXT, bank_account TEXT NOT NULL DEFAULT '',
      particulars TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at INTEGER NOT NULL,
      imported INTEGER NOT NULL DEFAULT 0, company_basis TEXT, source_row INTEGER)`);
    old.exec(`INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, status, created_at)
              VALUES ('imp-2', 'wwj', '1', 'Sample Supplier', 5, '2026-10-05', 'issued', 0)`);
    // Chosen by hand before the lock existed: the import left it Unassigned (basis "none").
    old.exec(`INSERT INTO cheques (id, company, cheque_no, payee, amount, issue_date, status, created_at, company_basis)
              VALUES ('imp-3', 'wythlae', '2', 'Sample Supplier', 5, '2026-10-05', 'issued', 0, 'none'),
                     ('imp-4', 'unassigned', '3', 'Sample Supplier', 5, '2026-10-05', 'issued', 0, 'none'),
                     ('imp-5', 'wwj', '4', 'Sample Supplier', 5, '2026-10-05', 'issued', 0, 'checkno-label')`);
    old.close();
    const reopened = openDatabase(file);
    const byId = Object.fromEntries(listCheques(reopened).map((c) => [c.id, c]));
    expect(byId["imp-2"].companyLocked).toBe(false);
    expect(byId["imp-3"]).toMatchObject({ company: "wythlae", companyLocked: true, companyBasis: "manual" });
    expect(byId["imp-4"].companyLocked).toBe(false);
    expect(byId["imp-5"]).toMatchObject({ companyLocked: false, companyBasis: "checkno-label" });
    reopened.close();
  });
});
