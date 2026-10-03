import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filterAndSort, issuedSummary, unassignedSummary } from "@/lib/register";
import { cheque } from "./helpers";

describe("filterAndSort", () => {
  it("hides cleared and voided by default", () => {
    const list = [
      cheque({ status: "issued" }),
      cheque({ status: "pending" }),
      cheque({ status: "cleared" }),
      cheque({ status: "voided" }),
    ];
    expect(filterAndSort(list, DEFAULT_FILTERS).map((c) => c.status)).toEqual(["issued", "pending"]);
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, hideSettled: false })).toHaveLength(4);
  });

  it("filters by company and status", () => {
    const list = [
      cheque({ company: "wwj" }),
      cheque({ company: "wythlae" }),
      cheque({ company: "wythlae", status: "pending" }),
    ];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, company: "wythlae" })).toHaveLength(2);
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, company: "wythlae", status: "pending" })).toHaveLength(1);
  });

  it("shows a chosen settled status even when hide is on", () => {
    const list = [cheque({ status: "cleared" }), cheque({ status: "issued" })];
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, status: "cleared" })).toHaveLength(1);
  });

  it("sorts by cheque date, then cheque no. in natural order", () => {
    const list = [
      cheque({ issueDate: "2026-10-05", chequeNo: "653507" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "WWJ682068" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "100" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "99" }),
      cheque({ issueDate: "2026-10-04", chequeNo: "0012" }),
    ];
    expect(filterAndSort(list, DEFAULT_FILTERS).map((c) => c.chequeNo)).toEqual([
      "0012",
      "99",
      "100",
      "WWJ682068",
      "653507",
    ]);
  });

  it("does not change the list it was given", () => {
    const list = [cheque({ issueDate: "2026-10-05" }), cheque({ issueDate: "2026-10-04" })];
    const before = list.map((c) => c.id);
    filterAndSort(list, DEFAULT_FILTERS);
    expect(list.map((c) => c.id)).toEqual(before);
  });
});

describe("summaries", () => {
  it("totals issued cheques only", () => {
    const list = [
      cheque({ amount: 100.1 }),
      cheque({ amount: 200.2 }),
      cheque({ amount: null }),
      cheque({ amount: 500, status: "pending" }),
      cheque({ amount: 500, status: "cleared" }),
    ];
    expect(issuedSummary(list)).toEqual({ total: 300.3, count: 3 });
  });

  it("totals unassigned cheques that are still pending or issued", () => {
    const list = [
      cheque({ company: "unassigned", amount: 10 }),
      cheque({ company: "unassigned", amount: 20, status: "pending" }),
      cheque({ company: "unassigned", amount: 40, status: "cleared" }),
      cheque({ company: "wwj", amount: 80 }),
    ];
    expect(unassignedSummary(list)).toEqual({ total: 30, count: 2 });
  });
});
