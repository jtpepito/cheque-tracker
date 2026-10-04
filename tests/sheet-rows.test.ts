import { describe, expect, it } from "vitest";
import { parseSheetDate, readRow, statusFromSheet, type SheetRow } from "@/lib/sheet-rows";

const row = (over: SheetRow = {}): SheetRow => ({
  id: "imp-2",
  row: 2,
  date: "2026-09-28",
  supplier: " Sample Supplier ",
  chequeNo: "590417",
  amount: 16882.63,
  chequeDate: "2026-10-05",
  status: "Released to Supplier",
  reference: " SI 1 ",
  ...over,
});

describe("parseSheetDate", () => {
  it("reads ISO dates and dates typed the sheet's way", () => {
    expect(parseSheetDate("2026-10-05")).toBe("2026-10-05");
    expect(parseSheetDate("12/10/25")).toBe("2025-12-10");
    expect(parseSheetDate("1/5/2026")).toBe("2026-01-05");
    expect(parseSheetDate(" 02/04/2026 ")).toBe("2026-02-04");
  });
  it("returns null for anything that is not a date", () => {
    for (const bad of ["13/45/26", "2026-02-30", "soon", "", null, undefined, 45000]) {
      expect(parseSheetDate(bad)).toBeNull();
    }
  });
});

describe("statusFromSheet", () => {
  it("maps the sheet's words, ignoring case and spaces", () => {
    expect(statusFromSheet("Cleared")).toBe("cleared");
    expect(statusFromSheet(" encashed ")).toBe("cleared");
    expect(statusFromSheet("for encashed")).toBe("cleared");
    expect(statusFromSheet("For  Encashed ")).toBe("cleared");
    expect(statusFromSheet("Released to Supplier")).toBe("issued");
    expect(statusFromSheet("Cancelled")).toBe("voided");
    expect(statusFromSheet("RETURNED")).toBe("voided");
    expect(statusFromSheet("Replaced")).toBe("voided");
    expect(statusFromSheet("With Christine")).toBe("pending");
  });
  it("treats blank or unknown words as issued", () => {
    expect(statusFromSheet("")).toBe("issued");
    expect(statusFromSheet(null)).toBe("issued");
    expect(statusFromSheet("Stale")).toBe("issued");
  });
});

describe("readRow", () => {
  it("reads a complete row and trims text", () => {
    expect(readRow(row(), 0)).toEqual({
      ok: true,
      value: {
        id: "imp-2",
        row: 2,
        payee: "Sample Supplier",
        chequeNo: "590417",
        amount: 16882.63,
        issueDate: "2026-10-05",
        encodedDate: "2026-09-28",
        particulars: "SI 1",
        status: "issued",
        statusText: "Released to Supplier",
      },
    });
  });

  it("reads an amount typed as text and a date typed as text", () => {
    const r = readRow(row({ amount: "₱16,882.63", chequeDate: "12/10/25" }), 0);
    expect(r.ok && r.value.amount).toBe(16882.63);
    expect(r.ok && r.value.issueDate).toBe("2025-12-10");
  });

  it("keeps a blank amount, a blank cheque date, a blank cheque no. and a blank logged date", () => {
    const r = readRow(row({ amount: "", chequeDate: "", chequeNo: "", date: "" }), 0);
    expect(r.ok && r.value).toMatchObject({ amount: null, issueDate: "", chequeNo: "", encodedDate: null });
  });

  it("drops the .0 from a numeric cheque no. and keeps leading zeros", () => {
    expect(readRow(row({ chequeNo: "663957.0" }), 0)).toMatchObject({ value: { chequeNo: "663957" } });
    expect(readRow(row({ chequeNo: "0012" }), 0)).toMatchObject({ value: { chequeNo: "0012" } });
  });

  it("reports a row with no Tracker ID, using its position when the row number is missing", () => {
    expect(readRow(row({ id: "", row: undefined }), 5)).toEqual({
      ok: false,
      problem: { row: 7, id: "", reason: "This row has no Tracker ID." },
    });
  });

  it("reports a cheque date or amount it cannot read", () => {
    expect(readRow(row({ chequeDate: "13/45/26" }), 0)).toEqual({
      ok: false,
      problem: { row: 2, id: "imp-2", reason: 'Cheque date "13/45/26" is not a date.' },
    });
    expect(readRow(row({ amount: "abc" }), 0)).toMatchObject({ ok: false, problem: { reason: 'Amount "abc" is not an amount.' } });
    expect(readRow(row({ amount: -5 }), 0)).toMatchObject({ ok: false, problem: { reason: 'Amount "-5" is not an amount.' } });
  });

  it("reports a row that is not an object", () => {
    expect(readRow(null as unknown as SheetRow, 3)).toEqual({
      ok: false,
      problem: { row: 5, id: "", reason: "This row could not be read." },
    });
  });
});
