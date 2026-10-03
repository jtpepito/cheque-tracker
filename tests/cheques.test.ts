import { beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@/lib/sql";
import { resetDb, testSql } from "./db";
import {
  ChequeError,
  getCompanyNames,
  listCheques,
  removeCheque,
  setCompany,
  setCompanyNames,
  upsertCheque,
} from "@/lib/cheques";
import { cheque } from "./helpers";

let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
});

describe("cheques store", () => {
  it("saves and lists a cheque with every field", async () => {
    const c = cheque({ chequeNo: "0012", encodedDate: "2026-09-28", companyBasis: "none", sourceRow: 7, imported: true });
    await upsertCheque(sql, c);
    expect((await listCheques(sql))).toEqual([c]);
  });

  it("replaces the cheque with the same id", async () => {
    const c = cheque({ amount: 10 });
    await upsertCheque(sql, c);
    await upsertCheque(sql, { ...c, amount: 20, status: "cleared" });
    expect((await listCheques(sql))).toEqual([{ ...c, amount: 20, status: "cleared" }]);
  });

  it("locks the company when it is chosen by hand", async () => {
    const c = cheque({ company: "unassigned", companyBasis: "none" });
    await upsertCheque(sql, c);
    expect(await setCompany(sql, c.id, "wwjcorp")).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
    expect((await listCheques(sql))[0]).toMatchObject({ company: "wwjcorp", companyLocked: true, companyBasis: "manual" });
  });

  it("reports an unknown id", async () => {
    try {
      await setCompany(sql, "nope", "wwj");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChequeError);
      expect((e as ChequeError).code).toBe("not_found");
    }
  });

  it("removes a cheque", async () => {
    const c = cheque();
    await upsertCheque(sql, c);
    await removeCheque(sql, c.id);
    expect((await listCheques(sql))).toEqual([]);
  });

  it("starts with the default company names and saves new ones", async () => {
    expect((await getCompanyNames(sql))).toEqual({ wwj: "WWJ Trading", wythlae: "Wythlae 1220", wwjcorp: "WWJ Corp" });
    await setCompanyNames(sql, { wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
    expect((await getCompanyNames(sql))).toEqual({ wwj: "WWJ", wythlae: "Wythlae", wwjcorp: "Corp" });
  });

  it("returns amounts and timestamps as numbers, not text", async () => {
    await upsertCheque(sql, cheque({ id: "n-1", amount: 100.5, createdAt: 1759449600000 }));
    await upsertCheque(sql, cheque({ id: "n-2", amount: null }));
    const all = await listCheques(sql);
    const one = all.find((c) => c.id === "n-1")!;
    expect(one.amount).toBe(100.5);
    expect(typeof one.createdAt).toBe("number");
    expect(one.createdAt).toBe(1759449600000);
    expect(all.find((c) => c.id === "n-2")!.amount).toBeNull();
    expect(typeof one.imported).toBe("boolean");
  });
});
