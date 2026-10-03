import { describe, expect, it } from "vitest";
import { validateNewCheque } from "@/lib/validate";

const good = {
  company: "wwj",
  chequeNo: " 0012 ",
  payee: " Sample Flour Supply ",
  amount: "12,500.50",
  issueDate: "2026-10-05",
  bankAccount: " BDO Current 1234 ",
  particulars: "SI 1001",
  status: "issued",
};

describe("validateNewCheque", () => {
  it("accepts a complete cheque and trims text", () => {
    const r = validateNewCheque(good);
    expect(r).toEqual({
      ok: true,
      value: {
        company: "wwj",
        chequeNo: "0012",
        payee: "Sample Flour Supply",
        amount: 12500.5,
        issueDate: "2026-10-05",
        bankAccount: "BDO Current 1234",
        particulars: "SI 1001",
        status: "issued",
      },
    });
  });

  it("lets bank account and particulars be blank and status default to issued", () => {
    const r = validateNewCheque({ ...good, bankAccount: undefined, particulars: "", status: undefined });
    expect(r.ok && r.value.bankAccount).toBe("");
    expect(r.ok && r.value.status).toBe("issued");
  });

  it("reports every missing or bad field", () => {
    const r = validateNewCheque({ company: "acme", chequeNo: " ", payee: "", amount: "0", issueDate: "2026-02-30", status: "cleared" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["amount", "chequeNo", "company", "issueDate", "payee", "status"]);
      expect(r.errors.amount).toBe("Enter an amount above zero.");
    }
  });

  it("rejects non-text values without throwing", () => {
    const r = validateNewCheque({ ...good, chequeNo: 12, payee: null });
    expect(r.ok).toBe(false);
  });

  it("rejects text that is too long", () => {
    const r = validateNewCheque({ ...good, payee: "x".repeat(201) });
    expect(!r.ok && r.errors.payee).toBe("Keep this under 200 characters.");
  });
});
