import type { Status } from "./types";

const NEXT: Record<Status, Status[]> = {
  pending: ["issued"],
  issued: ["cleared", "voided"],
  cleared: [],
  voided: [],
};

export function nextStatuses(from: Status): Status[] {
  return NEXT[from];
}

export function canTransition(from: Status, to: Status): boolean {
  return NEXT[from].includes(to);
}
