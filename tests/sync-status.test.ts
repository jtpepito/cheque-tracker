import { describe, expect, it } from "vitest";
import { syncLine } from "@/lib/sync-status";
import type { SyncReport } from "@/lib/sync";

// 3 Oct 2026, 2:15 PM in Manila.
const AT = Date.UTC(2026, 9, 3, 6, 15);
const MIN = 60_000;
const report = (over: Partial<SyncReport> = {}): SyncReport => ({
  at: AT, dryRun: false, rows: 587, added: 0, changed: 0, removed: 0, unchanged: 587, problems: [], ...over,
});

describe("syncLine", () => {
  it("says so before the first sync", () => {
    expect(syncLine(null, AT)).toEqual({ text: "Not yet connected to the sheet.", warn: false });
  });
  it("says how long ago the sheet synced and how many cheques it holds", () => {
    expect(syncLine(report(), AT + 20_000)).toEqual({ text: "Synced from the sheet just now · 587 cheques", warn: false });
    expect(syncLine(report(), AT + MIN)).toEqual({ text: "Synced from the sheet 1 minute ago · 587 cheques", warn: false });
    expect(syncLine(report(), AT + 59 * MIN).text).toBe("Synced from the sheet 59 minutes ago · 587 cheques");
    expect(syncLine(report(), AT + 90 * MIN).text).toBe("Synced from the sheet 1 hour ago · 587 cheques");
  });
  it("does not count rows that need fixing as cheques", () => {
    const problems = [{ row: 9, id: "x", reason: "bad" }];
    expect(syncLine(report({ rows: 1, problems }), AT).text).toBe("Synced from the sheet just now · 0 cheques");
    expect(syncLine(report({ rows: 2, problems }), AT).text).toBe("Synced from the sheet just now · 1 cheque");
  });
  it("warns, with the Manila time, when nothing has arrived for more than 90 minutes", () => {
    expect(syncLine(report(), AT + 91 * MIN)).toEqual({
      text: "No update from the sheet since 3 Oct, 2:15 PM. The calendar may be out of date.",
      warn: true,
    });
  });
  it("warns when the last sync from the sheet was refused, whatever its age", () => {
    expect(syncLine(report(), AT + MIN, { at: AT + 30_000, message: "This sync would remove 30 cheques." })).toEqual({
      text: "The sheet's last sync was refused at 3 Oct, 2:15 PM: This sync would remove 30 cheques.",
      warn: true,
    });
    expect(syncLine(null, AT, { at: AT, message: "Empty." }).warn).toBe(true);
  });
  it("copes with a clock that is slightly behind the server", () => {
    expect(syncLine(report(), AT - 5000).text).toBe("Synced from the sheet just now · 587 cheques");
  });
});
