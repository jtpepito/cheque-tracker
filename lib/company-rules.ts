import type { Company } from "./types";

// Which company wrote a cheque, worked out from the sheet. Nothing is guessed: when the rules
// do not single out one company the cheque stays Unassigned for staff to choose.

type Trading = Exclude<Company, "unassigned">;

/** The "Payment Details" text of each company's SI tab. */
export type SiRefs = Partial<Record<Trading, string>>;

// "WWJ Corp" is tested before "WWJ", which it contains.
const NAMES: Array<[Trading, RegExp]> = [
  ["wwjcorp", /wwj[\s\-_.]*corp/i],
  ["wythlae", /wythlae/i],
  ["wwj", /wwj/i],
];

function named(text: string): Trading | null {
  for (const [company, pattern] of NAMES) if (pattern.test(text)) return company;
  return null;
}

/**
 * True when the cheque number's digits (5 or more) appear in the text as a whole number: not part
 * of a longer number and not the start of an amount like 164,973.75.
 */
export function mentionsNumber(text: string, chequeNo: string): boolean {
  const digits = chequeNo.replace(/\D/g, "");
  if (digits.length < 5) return false;
  return new RegExp(`(?<![\\d,.])${digits}(?!\\d|[,.]\\d)`).test(text);
}

export function deriveCompany(
  chequeNo: string,
  supplier: string,
  siRefs: SiRefs,
): { company: Company; basis: "checkno-label" | "supplier-label" | "si-crossref" | "none" } {
  // The owner's rule: a cheque no. with CORP in it is always WWJ Corp's.
  const inChequeNo = /corp/i.test(chequeNo) ? "wwjcorp" : named(chequeNo);
  if (inChequeNo) return { company: inChequeNo, basis: "checkno-label" };
  const inSupplier = named(supplier);
  if (inSupplier) return { company: inSupplier, basis: "supplier-label" };

  const hits = (["wwj", "wythlae", "wwjcorp"] as const).filter((co) => mentionsNumber(siRefs[co] ?? "", chequeNo));
  if (hits.length === 1) return { company: hits[0], basis: "si-crossref" };
  return { company: "unassigned", basis: "none" };
}
