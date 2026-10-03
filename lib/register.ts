import { sumAmounts } from "./money";
import type { Cheque, Company, Status } from "./types";

export type Filters = { company: Company | "all"; status: Status | "all"; hideSettled: boolean };

export const DEFAULT_FILTERS: Filters = { company: "all", status: "all", hideSettled: true };

const settled = (c: Cheque) => c.status === "cleared" || c.status === "voided";

export function filterAndSort(cheques: Cheque[], filters: Filters): Cheque[] {
  return cheques
    .filter((c) => filters.company === "all" || c.company === filters.company)
    .filter((c) => (filters.status === "all" ? !(filters.hideSettled && settled(c)) : c.status === filters.status))
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) || a.chequeNo.localeCompare(b.chequeNo, "en", { numeric: true }),
    );
}

function summary(list: Cheque[]) {
  return { total: sumAmounts(list.map((c) => c.amount)), count: list.length };
}

/** "Issued, not yet cleared: ₱X across N cheques." */
export function issuedSummary(cheques: Cheque[]) {
  return summary(cheques.filter((c) => c.status === "issued"));
}

/** Unassigned cheques still to be settled; these are the ones staff need to review. */
export function unassignedSummary(cheques: Cheque[]) {
  return summary(cheques.filter((c) => c.company === "unassigned" && !settled(c)));
}
