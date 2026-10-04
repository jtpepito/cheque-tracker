import { beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";
import { listCheques, setCompany, upsertCheque } from "@/lib/cheques";
import type { SheetRow } from "@/lib/sheet-rows";
import { applySync, getLastCheck, getLastRefusal, getLastSync, parsePayload, recordRefusal, SyncRefused, type SyncPayload } from "@/lib/sync";
import { cheque } from "./helpers";

const sheetRow = (n: number, over: SheetRow = {}): SheetRow => ({
  id: `imp-${n}`,
  row: n,
  date: "2026-09-28",
  supplier: "Sample Supplier",
  chequeNo: String(590000 + n),
  amount: 100,
  chequeDate: "2026-10-05",
  status: "Released to Supplier",
  reference: "",
  ...over,
});

const payload = (rows: SheetRow[], over: Partial<SyncPayload> = {}): SyncPayload => ({
  dryRun: false,
  allowRemovals: false,
  rows,
  siRefs: {},
  ...over,
});

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

const byId = async (id: string) => (await listCheques(sql)).find((c) => c.id === id);

describe("applySync", () => {
  it("adds new cheques from the sheet", async () => {
    const report = await applySync(sql, payload([sheetRow(2), sheetRow(3)]), 1000);
    expect(report).toEqual({ at: 1000, dryRun: false, rows: 2, added: 2, changed: 0, removed: 0, unchanged: 0, problems: [], changes: [] });
    expect((await byId("imp-2"))).toMatchObject({
      payee: "Sample Supplier", chequeNo: "590002", amount: 100, issueDate: "2026-10-05", encodedDate: "2026-09-28",
      status: "issued", company: "unassigned", companyBasis: "none", imported: true, sourceRow: 2, createdAt: 1000,
    });
  });

  it("changes nothing when the same sync arrives twice", async () => {
    const rows = [sheetRow(2), sheetRow(3)];
    await applySync(sql, payload(rows), 1000);
    const before = (await listCheques(sql));
    const report = await applySync(sql, payload(rows), 2000);
    expect(report).toMatchObject({ added: 0, changed: 0, removed: 0, unchanged: 2 });
    expect((await listCheques(sql))).toEqual(before);
  });

  it("lets the sheet win, moving status in either direction", async () => {
    await applySync(sql, payload([sheetRow(2, { status: "Cleared" })]));
    const report = await applySync(sql, payload([sheetRow(2, { status: "Returned", amount: 250, supplier: "Renamed Supplier" })]));
    expect(report).toMatchObject({ changed: 1, unchanged: 0 });
    expect((await byId("imp-2"))).toMatchObject({ status: "voided", amount: 250, payee: "Renamed Supplier" });
  });

  it("matches by Tracker ID when the sheet is sorted, and a moved row is not a change", async () => {
    await applySync(sql, payload([sheetRow(2), sheetRow(3)]));
    const sorted = [sheetRow(3, { row: 2 }), sheetRow(2, { row: 3 })];
    const report = await applySync(sql, payload(sorted));
    expect(report).toMatchObject({ changed: 0, unchanged: 2 });
    expect((await byId("imp-2"))).toMatchObject({ chequeNo: "590002", sourceRow: 3 });
    expect((await byId("imp-3"))).toMatchObject({ chequeNo: "590003", sourceRow: 2 });
  });

  it("works out the company from the sheet on every sync", async () => {
    await applySync(sql, payload([sheetRow(2)]));
    expect((await byId("imp-2"))!.company).toBe("unassigned");
    await applySync(sql, payload([sheetRow(2)], { siRefs: { wythlae: "CBC 590002 100.00" } }));
    expect((await byId("imp-2"))).toMatchObject({ company: "wythlae", companyBasis: "si-crossref" });
  });

  it("never changes a company chosen by hand", async () => {
    await applySync(sql, payload([sheetRow(2)]));
    await setCompany(sql, "imp-2", "wwjcorp");
    const report = await applySync(sql, payload([sheetRow(2, { status: "Cleared" })], { siRefs: { wythlae: "CBC 590002 100.00" } }));
    expect(report).toMatchObject({ changed: 1 });
    expect((await byId("imp-2"))).toMatchObject({ company: "wwjcorp", companyBasis: "manual", companyLocked: true, status: "cleared" });
  });

  it("removes cheques that are no longer in the sheet, but not ones entered in the app", async () => {
    await upsertCheque(sql, cheque({ id: "typed-here", imported: false }));
    await applySync(sql, payload([sheetRow(2), sheetRow(3)]));
    const report = await applySync(sql, payload([sheetRow(2)]));
    expect(report).toMatchObject({ removed: 1, unchanged: 1 });
    expect((await listCheques(sql)).map((c) => c.id).sort()).toEqual(["imp-2", "typed-here"]);
  });

  it("refuses to remove more than 20 cheques unless told to, and changes nothing", async () => {
    const many = Array.from({ length: 23 }, (_, i) => sheetRow(i + 2));
    await applySync(sql, payload(many));
    try {
      await applySync(sql, payload([sheetRow(2), sheetRow(3, { status: "Cleared" })]));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SyncRefused);
      expect((e as SyncRefused).status).toBe(409);
      expect((e as Error).message).toContain("21 cheques");
    }
    expect((await listCheques(sql))).toHaveLength(23);
    expect((await byId("imp-3"))!.status).toBe("issued");

    const report = await applySync(sql, payload([sheetRow(2)], { allowRemovals: true }));
    expect(report.removed).toBe(22);
    expect((await listCheques(sql))).toHaveLength(1);
  });

  it("skips a row it cannot read, applies the rest, and keeps the known cheque as it was", async () => {
    await applySync(sql, payload([sheetRow(2), sheetRow(3)]));
    const report = await applySync(sql, payload([sheetRow(2, { chequeDate: "13/45/26", status: "Cleared" }), sheetRow(3, { status: "Cleared" })]));
    expect(report).toMatchObject({ rows: 2, changed: 1, removed: 0, unchanged: 0 });
    expect(report.problems).toEqual([{ row: 2, id: "imp-2", reason: 'Cheque date "13/45/26" is not a date.' }]);
    expect((await byId("imp-2"))).toMatchObject({ status: "issued", issueDate: "2026-10-05" });
    expect((await byId("imp-3"))!.status).toBe("cleared");
  });

  it("uses the first row when a Tracker ID is repeated and reports the others", async () => {
    const report = await applySync(sql, payload([sheetRow(2), sheetRow(2, { row: 9, amount: 999 })]));
    expect(report.added).toBe(1);
    expect(report.problems).toEqual([{ row: 9, id: "imp-2", reason: "Tracker ID imp-2 is used by more than one row." }]);
    expect((await byId("imp-2"))!.amount).toBe(100);
  });

  it("refuses a sync with no readable cheque rows, even with removals allowed", async () => {
    await applySync(sql, payload([sheetRow(2)]));
    for (const rows of [[], [sheetRow(2, { id: "" })]]) {
      try {
        await applySync(sql, payload(rows, { allowRemovals: true }));
        expect.unreachable();
      } catch (e) {
        expect((e as SyncRefused).status).toBe(400);
      }
    }
    expect((await listCheques(sql))).toHaveLength(1);
  });

  it("changes nothing on a dry run but reports what would happen", async () => {
    await applySync(sql, payload([sheetRow(2)]), 1000);
    const report = await applySync(sql, payload([sheetRow(2, { status: "Cleared" }), sheetRow(3)], { dryRun: true }), 2000);
    expect(report).toMatchObject({ dryRun: true, added: 1, changed: 1 });
    expect((await listCheques(sql))).toHaveLength(1);
    expect((await byId("imp-2"))!.status).toBe("issued");
    expect((await getLastSync(sql))!.at).toBe(1000);
  });

  it("remembers the last real sync", async () => {
    expect((await getLastSync(sql))).toBeNull();
    const report = await applySync(sql, payload([sheetRow(2), sheetRow(3, { amount: "abc" })]), 5000);
    expect((await getLastSync(sql))).toEqual(report);
  });
});

describe("parsePayload", () => {
  it("accepts the script's shape and fills the optional parts", async () => {
    expect(parsePayload({ rows: [{ id: "a" }] })).toEqual({ dryRun: false, allowRemovals: false, rows: [{ id: "a" }], siRefs: {} });
    expect(parsePayload({ rows: [], dryRun: true, allowRemovals: true, siRefs: { wwj: "x", other: "y", wythlae: 5 } })).toEqual({
      dryRun: true, allowRemovals: true, rows: [], siRefs: { wwj: "x" },
    });
  });
  it("rejects anything else", async () => {
    for (const bad of [null, [], "x", {}, { rows: "x" }, { rows: [], siRefs: [] }]) expect(parsePayload(bad)).toBeNull();
  });
});

describe("refusals", () => {
  it("remembers the last refusal until a real sync goes through", async () => {
    expect((await getLastRefusal(sql))).toBeNull();
    await recordRefusal(sql, "This sync would remove 30 cheques.", 4000);
    expect((await getLastRefusal(sql))).toEqual({ at: 4000, message: "This sync would remove 30 cheques." });
    await applySync(sql, payload([sheetRow(2)], { dryRun: true }), 5000);
    expect((await getLastRefusal(sql))).not.toBeNull();
    await applySync(sql, payload([sheetRow(2)]), 6000);
    expect((await getLastRefusal(sql))).toBeNull();
  });
});

describe("what changed", () => {
  it("lists each changed row with the fields that differ, and from-to for status and company", async () => {
    await applySync(sql, payload([sheetRow(2), sheetRow(3), sheetRow(4)]));
    const report = await applySync(
      sql,
      payload(
        [sheetRow(2, { status: "Cleared", amount: 250 }), sheetRow(3), sheetRow(4, { row: 9, chequeDate: "2026-10-06" })],
        { siRefs: { wythlae: "CBC 590003 100.00" } },
      ),
    );
    expect(report.changes).toEqual([
      { row: 2, id: "imp-2", fields: ["amount", "status: issued → cleared"] },
      { row: 3, id: "imp-3", fields: ["company: unassigned → wythlae"] },
      { row: 9, id: "imp-4", fields: ["cheque date"] },
    ]);
  });

  it("keeps the last check so its details can be looked at afterwards, without touching the last real sync", async () => {
    await applySync(sql, payload([sheetRow(2)]), 1000);
    expect(await getLastCheck(sql)).toBeNull();
    await applySync(sql, payload([sheetRow(2, { status: "Cleared" })], { dryRun: true }), 2000);
    expect(await getLastCheck(sql)).toMatchObject({ at: 2000, dryRun: true, changed: 1, changes: [{ id: "imp-2" }] });
    expect((await getLastSync(sql))!.at).toBe(1000);
    expect((await byId("imp-2"))!.status).toBe("issued");
  });
});
