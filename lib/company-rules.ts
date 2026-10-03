import type { Company } from "./types";

// Which company wrote a cheque, worked out from the sheet. Nothing is guessed: when the rules
// do not single out one company the cheque stays Unassigned for staff to choose.

type Trading = Exclude<Company, "unassigned">;

/** The "Payment Details" text of each company's SI tab. */
export type SiRefs = Partial<Record<Trading, string>>;

// "WWJ Corp" is tested before "WWJ", which it contains.
const NAMES: Array<[Trading, RegExp]> = [
  ["wwjcorp", /wwj\s*corp/i],
  ["wythlae", /wythlae/i],
  ["wwj", /wwj/i],
];

function named(text: string): Trading | null {
  for (const [company, pattern] of NAMES) if (pattern.test(text)) return company;
  return null;
}

export function deriveCompany(
  chequeNo: string,
  supplier: string,
  siRefs: SiRefs,
): { company: Company; basis: "checkno-label" | "supplier-label" | "si-crossref" | "none" } {
  const inChequeNo = named(chequeNo);
  if (inChequeNo) return { company: inChequeNo, basis: "checkno-label" };
  const inSupplier = named(supplier);
  if (inSupplier) return { company: inSupplier, basis: "supplier-label" };

  const digits = chequeNo.replace(/\D/g, "");
  if (digits.length >= 5) {
    // The whole number, not part of a longer one and not the start of an amount like 164,973.75.
    const whole = new RegExp(`(?<![\\d,.])${digits}(?!\\d|[,.]\\d)`);
    const hits = (["wwj", "wythlae", "wwjcorp"] as const).filter((co) => whole.test(siRefs[co] ?? ""));
    if (hits.length === 1) return { company: hits[0], basis: "si-crossref" };
  }
  return { company: "unassigned", basis: "none" };
}
