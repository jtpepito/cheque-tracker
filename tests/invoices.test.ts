import { beforeEach, describe, expect, it } from "vitest";
import { mentionsNumber } from "@/lib/company-rules";
import { invoicesForCheque, listInvoices, readInvoiceRows, replaceInvoices, type InvoiceRow } from "@/lib/invoices";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const raw = (over: Record<string, unknown> = {}) => ({
  row: 2,
  date: "2026-01-07",
  invoiceNo: "52089",
  supplier: "Sample Ingredients Inc.",
  gross: 65280,
  paymentDetails: "CBC 642848 75,079.61",
  ewt: "₱582.86",
  net: "64,697.14",
  ...over,
});

describe("mentionsNumber", () => {
  it("finds the cheque number as a whole number only", () => {
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "653511")).toBe(true);
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "65351")).toBe(false);
    expect(mentionsNumber("wwj cbc 653511 164,973.75", "164973")).toBe(false);
    expect(mentionsNumber("CBC WWJ 667033 75,500; MBTC REF 384162 2,000", "WWJ667033")).toBe(true);
    expect(mentionsNumber("anything", "")).toBe(false);
    expect(mentionsNumber("1234 only", "1234")).toBe(false);
  });
});

describe("readInvoiceRows", () => {
  it("reads a row with typed amounts and dates", () => {
    expect(readInvoiceRows("wythlae", [raw()])).toEqual([
      {
        company: "wythlae", tab: "", row: 2, invoiceDate: "2026-01-07", invoiceNo: "52089", supplier: "Sample Ingredients Inc.",
        gross: 65280, paymentDetails: "CBC 642848 75,079.61", ewt: 582.86, net: 64697.14,
      },
    ]);
  });
  it("keeps a row with an unreadable amount or date, as null or blank, rather than failing", () => {
    const [r] = readInvoiceRows("wwj", [raw({ gross: "n/a", date: "29/01/26", ewt: 0, net: "" })]);
    expect(r).toMatchObject({ gross: null, invoiceDate: "", ewt: 0, net: null });
  });
  it("skips blank rows and rows that are not objects, and numbers rows by position when row is missing", () => {
    const rows = readInvoiceRows("wwj", [raw({ row: undefined, supplier: "", invoiceNo: "", gross: "" }), null, raw({ row: undefined })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toBe(4);
  });
  it("drops a figure too large for the database instead of failing the whole sync", () => {
    const [r] = readInvoiceRows("wwj", [raw({ gross: 1e13, net: "9,999,999,999,999" })]);
    expect(r).toMatchObject({ gross: null, net: null });
  });
  it("keeps the tab a row came from", () => {
    expect(readInvoiceRows("wwjcorp", [raw({ tab: "WWJ CORP DR" })])[0].tab).toBe("WWJ CORP DR");
  });
  it("returns nothing for input that is not a list", () => {
    expect(readInvoiceRows("wwj", "x")).toEqual([]);
  });
});

describe("invoices store", () => {
  const rows: InvoiceRow[] = [
    ...readInvoiceRows("wythlae", [raw(), raw({ row: 3, invoiceNo: "52090", paymentDetails: "CBC 642848 75,079.61" })]),
    ...readInvoiceRows("wwj", [raw({ row: 2, invoiceNo: "9", paymentDetails: "wwj cbc 642848 1.00" })]),
  ];

  it("replaces everything on each sync", async () => {
    await replaceInvoices(sql, rows);
    expect((await listInvoices(sql, "wythlae")).map((r) => r.invoiceNo)).toEqual(["52089", "52090"]);
    await replaceInvoices(sql, rows.slice(0, 1));
    expect(await listInvoices(sql, "wythlae")).toHaveLength(1);
    expect(await listInvoices(sql, "wwj")).toEqual([]);
  });

  it("finds the invoices a cheque pays, from the cheque's own company only, in sheet order", async () => {
    await replaceInvoices(sql, rows);
    expect((await invoicesForCheque(sql, "wythlae", "642848")).map((r) => r.invoiceNo)).toEqual(["52089", "52090"]);
    expect(await invoicesForCheque(sql, "wwjcorp", "642848")).toEqual([]);
    expect(await invoicesForCheque(sql, "wythlae", "")).toEqual([]);
    expect(await invoicesForCheque(sql, "wythlae", "4284")).toEqual([]);
  });

  it("keeps rows with the same row number on different tabs, so a cheque paid through a DR tab is found", async () => {
    await replaceInvoices(sql, [
      ...readInvoiceRows("wwjcorp", [
        raw({ tab: "WWJ Corp SI", row: 20, invoiceNo: "111", paymentDetails: "WWJ CBC 667011 1.00" }),
        raw({ tab: "WWJ CORP DR", row: 20, invoiceNo: "", gross: 155000, ewt: "", net: "", paymentDetails: "CBC CORP 652503 155,000" }),
      ]),
    ]);
    expect(await listInvoices(sql, "wwjcorp")).toHaveLength(2);
    expect(await invoicesForCheque(sql, "wwjcorp", "CORP 652503")).toMatchObject([
      { tab: "WWJ CORP DR", row: 20, invoiceNo: "", gross: 155000, ewt: null, net: null },
    ]);
  });
});
