import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@/lib/db";
import {
  ChequeError,
  createCheque,
  getCompanyNames,
  listCheques,
  setCompany,
  setCompanyNames,
  setStatus,
} from "@/lib/cheques";
import type { NewChequeInput } from "@/lib/validate";

const input: NewChequeInput = {
  company: "wwj",
  chequeNo: "0012",
  payee: "Sample Flour Supply",
  amount: 12500.5,
  issueDate: "2026-10-05",
  bankAccount: "",
  particulars: "SI 1001",
  status: "pending",
};

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    return e instanceof ChequeError ? e.code : "other";
  }
  return "none";
}

describe("cheques store", () => {
  it("creates and lists a cheque with every field", () => {
    const c = createCheque(db, input, 1700000000000);
    expect(c).toMatchObject({ ...input, createdAt: 1700000000000, imported: false, encodedDate: null, sourceRow: null });
    expect(c.id).toMatch(/[0-9a-f-]{36}/);
    expect(listCheques(db)).toEqual([c]);
  });

  it("keeps leading zeros in the cheque no.", () => {
    expect(createCheque(db, input).chequeNo).toBe("0012");
  });

  it("rejects the same cheque no. twice for one company", () => {
    createCheque(db, input);
    expect(codeOf(() => createCheque(db, input))).toBe("duplicate");
    expect(listCheques(db)).toHaveLength(1);
    createCheque(db, { ...input, chequeNo: "WWJ1" });
    expect(codeOf(() => createCheque(db, { ...input, chequeNo: "wwj1" }))).toBe("duplicate");
  });

  it("allows the same cheque no. for another company, or after the first is voided", () => {
    const first = createCheque(db, { ...input, status: "issued" });
    createCheque(db, { ...input, company: "wythlae" });
    setStatus(db, first.id, "voided");
    createCheque(db, input);
    expect(listCheques(db)).toHaveLength(3);
  });

  it("moves pending to issued to cleared", () => {
    const c = createCheque(db, input);
    expect(setStatus(db, c.id, "issued").status).toBe("issued");
    expect(setStatus(db, c.id, "cleared").status).toBe("cleared");
  });

  it("refuses a move that is not allowed, with a message naming the current status", () => {
    const c = createCheque(db, { ...input, status: "issued" });
    setStatus(db, c.id, "cleared");
    try {
      setStatus(db, c.id, "cleared");
      expect.unreachable();
    } catch (e) {
      expect((e as ChequeError).code).toBe("conflict");
      expect((e as Error).message).toBe("This cheque is already cleared.");
    }
    expect(codeOf(() => setStatus(db, c.id, "issued"))).toBe("conflict");
  });

  it("reports an unknown id", () => {
    expect(codeOf(() => setStatus(db, "nope", "issued"))).toBe("not_found");
    expect(codeOf(() => setCompany(db, "nope", "wwj"))).toBe("not_found");
  });

  it("changes the company on any row", () => {
    const c = createCheque(db, { ...input, company: "unassigned", status: "issued" });
    setStatus(db, c.id, "cleared");
    expect(setCompany(db, c.id, "wwjcorp").company).toBe("wwjcorp");
  });

  it("starts with the default company names and saves new ones", () => {
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
    setCompanyNames(db, { wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
    expect(getCompanyNames(db)).toEqual({ wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
  });
});
