import { describe, expect, it } from "vitest";
import { deriveCompany } from "@/lib/company-rules";

const si = {
  wwj: "wwj cbc 653511 164,973.75\nCBC 642758 157,580.36",
  wythlae: "CBC 642848 75,079.61\nMB FT 7325.00",
  wwjcorp: "CBC 667011 29,035.38",
};

describe("deriveCompany", () => {
  it("uses a company name in the cheque no. first", () => {
    expect(deriveCompany("WWJ 653507", "Wythlae Supplier", si)).toEqual({ company: "wwj", basis: "checkno-label" });
    expect(deriveCompany("WWJ682068", "Sample", {})).toEqual({ company: "wwj", basis: "checkno-label" });
    expect(deriveCompany("wythlae 100200", "Sample", {})).toEqual({ company: "wythlae", basis: "checkno-label" });
  });

  it("tests WWJ Corp before WWJ", () => {
    expect(deriveCompany("WWJ Corp 667011", "Sample", {})).toEqual({ company: "wwjcorp", basis: "checkno-label" });
    expect(deriveCompany("123456", "SBC - WWJCORP CBC", {})).toEqual({ company: "wwjcorp", basis: "supplier-label" });
  });

  it("then a company name in the supplier", () => {
    expect(deriveCompany("620965", "SBC - Wythlae 2 CBC", si)).toEqual({ company: "wythlae", basis: "supplier-label" });
  });

  it("then the cheque no. found in exactly one company's SI tab", () => {
    expect(deriveCompany("653511", "Sample Supplier", si)).toEqual({ company: "wwj", basis: "si-crossref" });
    expect(deriveCompany("642848", "Sample Supplier", si)).toEqual({ company: "wythlae", basis: "si-crossref" });
    expect(deriveCompany("667011", "Sample Supplier", si)).toEqual({ company: "wwjcorp", basis: "si-crossref" });
  });

  it("matches the whole number only, never part of a longer number or an amount", () => {
    expect(deriveCompany("65351", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("7325", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("164973", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
  });

  it("does not guess when the number is in two companies' tabs, or nowhere, or blank", () => {
    const both = { wwj: "CBC 700100 1.00", wythlae: "CBC 700100 1.00" };
    expect(deriveCompany("700100", "Sample", both)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("999999", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
    expect(deriveCompany("", "Sample", si)).toEqual({ company: "unassigned", basis: "none" });
  });
});
