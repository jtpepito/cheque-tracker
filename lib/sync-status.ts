import type { SyncRefusal, SyncReport } from "./sync";

/** After this long without a sync the page warns that it may be out of date. */
export const STALE_MS = 90 * 60 * 1000;

/** "3 Oct, 2:15 PM" in Manila. Built from parts so the spacing does not vary between systems. */
function manilaTime(at: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

export function syncLine(
  sync: SyncReport | null,
  now: number,
  refusal: SyncRefusal | null = null,
): { text: string; warn: boolean } {
  if (refusal) {
    return { text: `The sheet's last sync was refused at ${manilaTime(refusal.at)}: ${refusal.message}`, warn: true };
  }
  if (!sync) return { text: "Not yet connected to the sheet.", warn: false };
  const age = Math.max(0, now - sync.at);
  if (age > STALE_MS) {
    return { text: `No update from the sheet since ${manilaTime(sync.at)}. The calendar may be out of date.`, warn: true };
  }
  const cheques = sync.rows - sync.problems.length;
  return { text: `Synced from the sheet ${ago(age)} · ${cheques} ${cheques === 1 ? "cheque" : "cheques"}`, warn: false };
}
