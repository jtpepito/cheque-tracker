import { beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";
import { getCompanyNames, listCheques, setCompany, upsertCheque } from "@/lib/cheques";
import { importCheques, type ImportFile } from "@/lib/import";
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

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

describe("importCheques", () => {
  it("loads rows with every field", async () => {
    const r = await importCheques(sql, { cheques: [row()] });
    expect(r.count).toBe(1);
    expect((await listCheques(sql))[0]).toEqual({ ...row(), companyLocked: false, statusChangedAt: null });
  });

  it("can be run twice without duplicating rows, and the file wins", async () => {
    const file: ImportFile = { cheques: [row(), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] };
    await importCheques(sql, file);
    await upsertCheque(sql, { ...(await listCheques(sql)).find((c) => c.id === "imp-2")!, payee: "Edited" });
    await importCheques(sql, file);
    const all = (await listCheques(sql));
    expect(all).toHaveLength(2);
    expect(all.find((c) => c.id === "imp-2")!.payee).toBe("Sample Supplier");
  });

  it("leaves cheques that are not in the file alone", async () => {
    await upsertCheque(sql, cheque({ id: "other-1" }));
    await importCheques(sql, { cheques: [row()] });
    expect((await listCheques(sql))).toHaveLength(2);
  });

  it("keeps a blank amount as null and a numeric cheque no. as text", async () => {
    await importCheques(sql, { cheques: [row({ amount: null, chequeNo: 657516 }), row({ id: "imp-4", amount: "" })] });
    const all = (await listCheques(sql));
    expect(all.find((c) => c.id === "imp-2")).toMatchObject({ amount: null, chequeNo: "657516" });
    expect(all.find((c) => c.id === "imp-4")!.amount).toBeNull();
  });

  it("keeps a row whose cheque date is blank in the source, with an empty date", async () => {
    await importCheques(sql, { cheques: [row({ issueDate: null }), row({ id: "imp-5", issueDate: "" })] });
    expect((await listCheques(sql)).map((c) => c.issueDate)).toEqual(["", ""]);
  });

  it("fills optional fields that are missing", async () => {
    await importCheques(sql, { cheques: [{ id: "x1", company: "wwj", chequeNo: "1", payee: "P", amount: 5, issueDate: "2026-10-05", status: "issued" }] });
    expect((await listCheques(sql))[0]).toMatchObject({ bankAccount: "", particulars: "", encodedDate: null, imported: false, sourceRow: null });
  });

  it("stops and saves nothing when a row is unusable", async () => {
    const bad = [row(), row({ id: "imp-9", issueDate: "05/10/2026" })];
    await expect(importCheques(sql, { cheques: bad })).rejects.toThrow(/imp-9.*cheque date/);
    expect((await listCheques(sql))).toHaveLength(0);
    await expect(importCheques(sql, { cheques: [row({ company: "acme" })] })).rejects.toThrow(/company/);
    await expect(importCheques(sql, { cheques: [row({ status: "lost" })] })).rejects.toThrow(/status/);
    await expect(importCheques(sql, { cheques: [row({ id: "" })] })).rejects.toThrow(/id/);
  });

  it("applies company names from the file", async () => {
    await importCheques(sql, { companies: { wwj: "WWJ Renamed" }, cheques: [] });
    expect((await getCompanyNames(sql))).toEqual({ wwj: "WWJ Renamed", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
  });

  it("summarises the whole register by company", async () => {
    const r = await importCheques(sql, {
      cheques: [row(), row({ id: "imp-3", company: "unassigned", amount: 200 }), row({ id: "imp-4", amount: null })],
    });
    expect(r.summary).toBe(
      "[import] 3 cheques, ₱300.50 | wwj 2 ₱100.50 | wythlae 0 ₱0.00 | wwjcorp 0 ₱0.00 | unassigned 1 ₱200.00",
    );
  });
});


describe("import strictness", () => {
  it("reads an amount typed as text", async () => {
    await importCheques(sql, { cheques: [row({ amount: "1,250.00" })] });
    expect((await listCheques(sql))[0].amount).toBe(1250);
  });

  it("stops on an amount it cannot read, naming the row", async () => {
    await expect(importCheques(sql, { cheques: [row({ amount: "abc" })] })).rejects.toThrow(/imp-2.*amount/);
    await expect(importCheques(sql, { cheques: [row({ amount: -5 })] })).rejects.toThrow(/imp-2.*amount/);
    expect((await listCheques(sql))).toHaveLength(0);
  });

  it("stops on a row that is not an object, naming the row", async () => {
    await expect(importCheques(sql, { cheques: [row(), null as unknown as Record<string, unknown>] })).rejects.toThrow(/Row 2/);
  });

  it("stops on a company name that is not text", async () => {
    const companies = { wwj: 5 } as unknown as { wwj: string };
    await expect(importCheques(sql, { companies, cheques: [] })).rejects.toThrow(/company name/);
    expect((await getCompanyNames(sql)).wwj).toBe("WWJ Trading");
  });

  it("drops the .0 a spreadsheet adds to a numeric cheque no.", async () => {
    await importCheques(sql, { cheques: [row({ chequeNo: "663957.0" }), row({ id: "imp-3", chequeNo: "WWJ1.0" })] });
    expect((await listCheques(sql)).map((c) => c.chequeNo).sort()).toEqual(["663957", "WWJ1.0"]);
  });


});

describe("import and hand-chosen companies", () => {
  it("keeps a company chosen by hand when the file is loaded again", async () => {
    const file: ImportFile = { cheques: [row(), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] };
    await importCheques(sql, file);
    await setCompany(sql, "imp-2", "wythlae");
    await importCheques(sql, { cheques: [row({ amount: 999 }), row({ id: "imp-3", sourceRow: 3, chequeNo: "WWJ000002" })] });
    const all = (await listCheques(sql));
    expect(all.find((c) => c.id === "imp-2")).toMatchObject({ company: "wythlae", companyLocked: true, companyBasis: "manual", amount: 999 });
    expect(all.find((c) => c.id === "imp-3")).toMatchObject({ company: "wwj", companyLocked: false });
  });
});
