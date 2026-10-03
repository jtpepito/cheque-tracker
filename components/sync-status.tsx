import type { SyncReport } from "@/lib/sync";
import { syncLine } from "@/lib/sync-status";

/** When the sheet last synced, and any sheet rows the app could not read. */
export function SyncStatus({ sync, now }: { sync: SyncReport | null; now: number }) {
  const line = syncLine(sync, now);
  const problems = sync?.problems ?? [];
  return (
    <div className="space-y-2 text-sm">
      <p
        role="status"
        className={line.warn ? "rounded-lg bg-warn p-3 font-medium text-warn-ink" : "text-muted"}
      >
        {line.text}
      </p>
      {problems.length > 0 && (
        <div className="rounded-lg border border-danger p-3">
          <p className="font-semibold text-danger">
            Sheet rows to fix ({problems.length}). These were skipped until they are corrected in the sheet:
          </p>
          <ul className="mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={`${p.row}-${p.id}`}>
                Row {p.row}: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
