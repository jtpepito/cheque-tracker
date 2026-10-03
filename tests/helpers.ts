import type { Cheque } from "@/lib/types";

let n = 0;
/** A made-up cheque. Never use real payees or amounts in tests. */
export function cheque(over: Partial<Cheque> = {}): Cheque {
  n += 1;
  return {
    id: `t-${n}`,
    company: "wwj",
    chequeNo: String(1000 + n),
    payee: "Sample Supplier",
    amount: 100,
    issueDate: "2026-10-03",
    encodedDate: null,
    bankAccount: "",
    particulars: "",
    status: "issued",
    createdAt: 0,
    imported: false,
    companyBasis: null,
    sourceRow: null,
    ...over,
  };
}
