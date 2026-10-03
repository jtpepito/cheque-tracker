import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { getCompanyNames, listCheques, setCompany, upsertCheque } from "@/lib/cheques";
import { openDatabase } from "@/lib/db";
import { importCheques, importIfPresent, type ImportFile } from "@/lib/import";
import { cheque } from "./helpers";

const row = (over: Record<string, unknown> = {}) => ({
  id: "imp-2",
  company: "wwj",
  chequeNo: "WWJ000001",
  payee: "Sample Supplier",
  amount: 100.5,
  issueDate: "2026-10-05",
  encodedDate: "2026-09-28",
  bankAccount: "",
  particulars: "SI 1",
  status: "issued",
  createdAt: 1759449600000,
  imported: true,
  companyBasis: "chequeNo",
  sourceRow: 2,
  ...over,
});

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

describe("importCheques", () => {
  it("loads rows with every field", () => {
    const r = importCheques(db, { cheques: [row()] });
    expect(r.count).toBe(1);
    expect(listCheques(db)[0]).toEqual({ ...row(), companyLocked: false });
  });

  it("can be run twice without duplicating rows, and the file wins", () => {
    const file: ImportFile = { cheques: [row(), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] };
    importCheques(db, file);
    upsertCheque(db, { ...listCheques(db).find((c) => c.id === "imp-2")!, payee: "Edited" });
    importCheques(db, file);
    const all = listCheques(db);
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id === "imp-2")!.payee).toBe("Sample Supplier");
  });

  it("leaves cheques that are not in the file alone", () => {
    upsertCheque(db, cheque({ id: "other-1" }));
    importCheques(db, { cheques: [row()] });
    expect(listCheques(db)).toHaveLength(2);
  });

  it("keeps a blank amount as null and a numeric cheque no. as text", () => {
    importCheques(db, { cheques: [row({ amount: null, chequeNo: 657516 }), row({ id: "imp-4", amount: "" })] });
    const all = listCheques(db);
    expect(all.find((c) => c.id === "imp-2")).toMatchObject({ amount: null, chequeNo: "657516" });
    expect(all.find((c) => c.id === "imp-4")!.amount).toBeNull();
  });

  it("keeps a row whose cheque date is blank in the source, with an empty date", () => {
    importCheques(db, { cheques: [row({ issueDate: null }), row({ id: "imp-5", issueDate: "" })] });
    expect(listCheques(db).map((c) => c.issueDate)).toEqual(["", ""]);
  });

  it("fills optional fields that are missing", () => {
    importCheques(db, { cheques: [{ id: "x1", company: "wwj", chequeNo: "1", payee: "P", amount: 5, issueDate: "2026-10-05", status: "issued" }] });
    expect(listCheques(db)[0]).toMatchObject({ bankAccount: "", particulars: "", encodedDate: null, imported: false, sourceRow: null });
  });

  it("stops and saves nothing when a row is unusable", () => {
    const bad = [row(), row({ id: "imp-9", issueDate: "05/10/2026" })];
    expect(() => importCheques(db, { cheques: bad })).toThrow(/imp-9.*cheque date/);
    expect(listCheques(db)).toHaveLength(0);
    expect(() => importCheques(db, { cheques: [row({ company: "acme" })] })).toThrow(/company/);
    expect(() => importCheques(db, { cheques: [row({ status: "lost" })] })).toThrow(/status/);
    expect(() => importCheques(db, { cheques: [row({ id: "" })] })).toThrow(/id/);
  });

  it("applies company names from the file", () => {
    importCheques(db, { companies: { wwj: "WWJ Renamed" }, cheques: [] });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Renamed", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
  });

  it("summarises the whole register by company", () => {
    const r = importCheques(db, {
      cheques: [row(), row({ id: "imp-3", company: "unassigned", amount: 200 }), row({ id: "imp-4", amount: null })],
    });
    expect(r.summary).toBe(
      "[import] 3 cheques, ₱300.50 | wwj 2 ₱100.50 | wythlae 0 ₱0.00 | wwjcorp 0 ₱0.00 | unassigned 1 ₱200.00",
    );
  });
});

describe("importIfPresent", () => {
  it("does nothing when there is no file", () => {
    expect(importIfPresent(db, path.join(os.tmpdir(), "no-such-cheques-import.json"))).toBeNull();
  });

  it("imports the file once and renames it so it is not loaded again", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheques-"));
    const file = path.join(dir, "cheques-import.json");
    fs.writeFileSync(file, JSON.stringify({ cheques: [row()] }));
    expect(importIfPresent(db, file)!.count).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir).some((n) => /^cheques-import\.imported-\d{4}-\d{2}-\d{2}\.json$/.test(n))).toBe(true);
    expect(importIfPresent(db, file)).toBeNull();
  });
});

describe("import strictness", () => {
  it("reads an amount typed as text", () => {
    importCheques(db, { cheques: [row({ amount: "1,250.00" })] });
    expect(listCheques(db)[0].amount).toBe(1250);
  });

  it("stops on an amount it cannot read, naming the row", () => {
    expect(() => importCheques(db, { cheques: [row({ amount: "abc" })] })).toThrow(/imp-2.*amount/);
    expect(() => importCheques(db, { cheques: [row({ amount: -5 })] })).toThrow(/imp-2.*amount/);
    expect(listCheques(db)).toHaveLength(0);
  });

  it("stops on a row that is not an object, naming the row", () => {
    expect(() => importCheques(db, { cheques: [row(), null as unknown as Record<string, unknown>] })).toThrow(/Row 2/);
  });

  it("stops on a company name that is not text", () => {
    const companies = { wwj: 5 } as unknown as { wwj: string };
    expect(() => importCheques(db, { companies, cheques: [] })).toThrow(/company name/);
    expect(getCompanyNames(db).wwj).toBe("WWJ Trading");
  });

  it("drops the .0 a spreadsheet adds to a numeric cheque no.", () => {
    importCheques(db, { cheques: [row({ chequeNo: "663957.0" }), row({ id: "imp-3", chequeNo: "WWJ1.0" })] });
    expect(listCheques(db).map((c) => c.chequeNo).sort()).toEqual(["663957", "WWJ1.0"]);
  });

  it("loads nothing when the file cannot be renamed, so it is never loaded twice", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheques-"));
    const file = path.join(dir, "cheques-import.json");
    fs.writeFileSync(file, JSON.stringify({ cheques: [row()] }));
    // A folder squatting on the renamed file's name makes the rename fail.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    fs.mkdirSync(path.join(dir, `cheques-import.imported-${today}.json`));
    expect(() => importIfPresent(db, file)).toThrow();
    expect(listCheques(db)).toHaveLength(0);
  });

  it("puts the file back when its contents are bad, so it can be fixed and retried", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cheques-"));
    const file = path.join(dir, "cheques-import.json");
    fs.writeFileSync(file, JSON.stringify({ cheques: [row({ company: "acme" })] }));
    expect(() => importIfPresent(db, file)).toThrow(/company/);
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("import and hand-chosen companies", () => {
  it("keeps a company chosen by hand when the file is loaded again", () => {
    const file: ImportFile = { cheques: [row(), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] };
    importCheques(db, file);
    setCompany(db, "imp-2", "wythlae");
    importCheques(db, { cheques: [row({ amount: 999 }), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] });
    const all = listCheques(db);
    expect(all.find((c) => c.id === "imp-2")).toMatchObject({ company: "wythlae", companyLocked: true, companyBasis: "manual", amount: 999 });
    expect(all.find((c) => c.id === "imp-3")).toMatchObject({ company: "wwj", companyLocked: false });
  });
});
