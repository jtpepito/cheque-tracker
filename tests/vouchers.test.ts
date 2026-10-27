import { beforeEach, describe, expect, it } from "vitest";
import { removeCheque, setCompany, upsertCheque } from "@/lib/cheques";
import { readInvoiceRows, replaceInvoices } from "@/lib/invoices";
import type { Sql } from "@/lib/sql";
import {
  createVoucherForCheque, deleteVoucher, getCompanyDetails, getVoucher, listVouchers, setCompanyDetails,
  updateVoucher, validateVoucherInput, VoucherError, vouchersByCheque, type Voucher, type VoucherInput,
} from "@/lib/vouchers";
import { resetDb, testSql } from "./db";
import { cheque } from "./helpers";

const TODAY = "2026-10-27";
const toInput = (v: Voucher): VoucherInput => ({
  voucherDate: v.voucherDate, payee: v.payee, amount: v.amount, preparedBy: v.preparedBy, checkedBy: v.checkedBy,
  approvedBy: v.approvedBy, receivedBy: v.receivedBy, notes: v.notes,
  lines: v.lines.map(({ invoiceNo, invoiceDate, description, gross, ewt, net }) => ({ invoiceNo, invoiceDate, description, gross, ewt, net })),
});
let sql: Sql;
beforeEach(async () => {
  sql = await testSql();
  await resetDb(sql);
  await upsertCheque(sql, cheque({ id: "c1", company: "wythlae", chequeNo: "642848", payee: "Sample Ingredients Inc.", amount: 75079.61, issueDate: "2026-11-02" }));
  await upsertCheque(sql, cheque({ id: "c2", company: "wythlae", chequeNo: "642849", amount: 10 }));
  await upsertCheque(sql, cheque({ id: "c3", company: "wwj", chequeNo: "WWJ682052", amount: 20 }));
  await upsertCheque(sql, cheque({ id: "c4", company: "unassigned", chequeNo: "1", amount: 5 }));
  await replaceInvoices(sql, [
    ...readInvoiceRows("wythlae", [
      { row: 2, date: "2026-01-07", invoiceNo: "52089", supplier: "Sample Ingredients Inc.", gross: 65280, paymentDetails: "CBC 642848 75,079.61", ewt: 582.86, net: 64697.14 },
      { row: 3, date: "2026-01-07", invoiceNo: "52090", supplier: "Sample Ingredients Inc.", gross: 10476, paymentDetails: "CBC 642848 75,079.61", ewt: 93.54, net: 10382.46 },
      { row: 4, date: "2026-01-09", invoiceNo: "13707", supplier: "Other Supplier", gross: 7325, paymentDetails: "MB FT 7325.00", ewt: 0, net: 7325 },
    ]),
    ...readInvoiceRows("wwj", [{ row: 2, invoiceNo: "X", supplier: "WWJ Supplier", gross: 1, paymentDetails: "CBC 642848 1.00" }]),
  ]);
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "none";
  } catch (e) {
    return e instanceof VoucherError ? e.code : "other";
  }
};

describe("creating a voucher", () => {
  it("numbers it in the company's series and fills the lines from the sheet", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    expect(v).toMatchObject({ number: "WYT-CV-0001", company: "wythlae", chequeId: "c1", voucherDate: TODAY, payee: "Sample Ingredients Inc.", amount: 75079.61, createdAt: 1000 });
    expect(v.lines.map((l) => [l.position, l.invoiceNo, l.description, l.gross, l.ewt, l.net])).toEqual([
      [1, "52089", "Sample Ingredients Inc.", 65280, 582.86, 64697.14],
      [2, "52090", "Sample Ingredients Inc.", 10476, 93.54, 10382.46],
    ]);
  });

  it("gives each company its own series and never reuses a number", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    const b = await createVoucherForCheque(sql, "c2", TODAY);
    const c = await createVoucherForCheque(sql, "c3", TODAY);
    expect([a.number, b.number, c.number]).toEqual(["WYT-CV-0001", "WYT-CV-0002", "WWJ-CV-0001"]);
    await deleteVoucher(sql, b.id);
    await upsertCheque(sql, cheque({ id: "c5", company: "wythlae", chequeNo: "7", amount: 1 }));
    expect((await createVoucherForCheque(sql, "c5", TODAY)).number).toBe("WYT-CV-0003");
  });

  it("returns the existing voucher instead of making a second one", async () => {
    const first = await createVoucherForCheque(sql, "c1", TODAY);
    const again = await createVoucherForCheque(sql, "c1", TODAY);
    expect(again.id).toBe(first.id);
    expect(await listVouchers(sql)).toHaveLength(1);
  });

  it("refuses an unassigned cheque and an unknown one", async () => {
    expect(await codeOf(createVoucherForCheque(sql, "c4", TODAY))).toBe("unassigned");
    expect(await codeOf(createVoucherForCheque(sql, "nope", TODAY))).toBe("not_found");
  });

  it("makes a voucher with no lines when the sheet has no matching invoices", async () => {
    expect((await createVoucherForCheque(sql, "c2", TODAY)).lines).toEqual([]);
  });
});

describe("saving a voucher", () => {
  const input: VoucherInput = {
    voucherDate: "2026-10-28", payee: "Sample Ingredients Incorporated", amount: 75079.61,
    preparedBy: "A. Staff", checkedBy: "B. Staff", approvedBy: "C. Owner", receivedBy: "", notes: "October deliveries",
    lines: [
      { invoiceNo: "52089", invoiceDate: "2026-01-07", description: "Flour", gross: 65280, ewt: 582.86, net: 64697.14 },
      { invoiceNo: "", invoiceDate: "", description: "Freight", gross: null, ewt: null, net: 10382.46 },
    ],
  };

  it("replaces the details and the lines, in order", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    const saved = await updateVoucher(sql, v.id, input, 2000);
    expect(saved).toMatchObject({ ...input, lines: expect.any(Array), updatedAt: 2000, number: "WYT-CV-0001" });
    expect(saved.lines.map((l) => [l.position, l.description, l.net])).toEqual([[1, "Flour", 64697.14], [2, "Freight", 10382.46]]);
    expect(await getVoucher(sql, v.id)).toEqual(saved);
  });

  it("reports an unknown voucher", async () => {
    expect(await codeOf(updateVoucher(sql, "nope", input))).toBe("not_found");
  });
});

describe("validateVoucherInput", () => {
  const good = {
    voucherDate: "2026-10-28", payee: " Sample ", amount: "75,079.61", preparedBy: "A", checkedBy: "", approvedBy: "", receivedBy: "", notes: "",
    lines: [{ invoiceNo: " 1 ", invoiceDate: "2026-01-07", description: "Flour", gross: "65,280", ewt: "", net: 64697.14 }],
  };
  it("accepts typed amounts and trims text", () => {
    const r = validateVoucherInput(good);
    expect(r.ok && r.value).toMatchObject({ payee: "Sample", amount: 75079.61, lines: [{ invoiceNo: "1", gross: 65280, ewt: null, net: 64697.14 }] });
  });
  it("names the field or line that is wrong", () => {
    const r = validateVoucherInput({ ...good, amount: "0", voucherDate: "2026-02-30", lines: [{ ...good.lines[0], gross: "abc" }, { description: "ok" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["amount", "lines.0.gross", "voucherDate"]);
  });
  it("rejects a shape that is not a voucher", () => {
    expect(validateVoucherInput(null).ok).toBe(false);
    expect(validateVoucherInput({ ...good, lines: "x" }).ok).toBe(false);
  });
});

describe("listing and deleting", () => {
  it("lists newest first with the cheque's number and status, and maps cheques to vouchers", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY, 1000);
    const b = await createVoucherForCheque(sql, "c3", TODAY, 2000);
    const list = await listVouchers(sql);
    expect(list.map((v) => v.number)).toEqual([b.number, a.number]);
    expect(list[1]).toMatchObject({ chequeNo: "642848", chequeStatus: "issued" });
    expect(await vouchersByCheque(sql)).toEqual({ c1: a.id, c3: b.id });
  });

  it("deletes a voucher for an issued cheque but keeps one for a cleared cheque", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await upsertCheque(sql, cheque({ id: "c3", company: "wwj", chequeNo: "WWJ682052", amount: 20, status: "cleared" }));
    const b = await createVoucherForCheque(sql, "c3", TODAY);
    expect(await codeOf(deleteVoucher(sql, b.id))).toBe("kept");
    await deleteVoucher(sql, a.id);
    expect(await getVoucher(sql, a.id)).toBeNull();
    expect(await codeOf(deleteVoucher(sql, "nope"))).toBe("not_found");
  });

  it("survives its cheque being removed from the sheet", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await removeCheque(sql, "c1");
    expect((await getVoucher(sql, a.id))!.chequeId).toBeNull();
    expect((await listVouchers(sql))[0]).toMatchObject({ chequeNo: null, chequeStatus: null });
    await deleteVoucher(sql, a.id);
  });

  it("keeps the voucher's company even if the cheque's company is changed later", async () => {
    const a = await createVoucherForCheque(sql, "c1", TODAY);
    await setCompany(sql, "c1", "wwj");
    expect((await getVoucher(sql, a.id))!.company).toBe("wythlae");
  });
});

describe("company details", () => {
  it("starts blank and saves addresses and TINs", async () => {
    expect((await getCompanyDetails(sql)).wwj).toEqual({ address: "", tin: "" });
    await setCompanyDetails(sql, { wwj: { address: "1 Sample St, Cebu", tin: "000-000-000-000" }, wythlae: { address: "", tin: "" }, wwjcorp: { address: "", tin: "" } });
    expect((await getCompanyDetails(sql)).wwj).toEqual({ address: "1 Sample St, Cebu", tin: "000-000-000-000" });
  });
});

describe("who made and saved a voucher", () => {
  it("records the maker, pre-fills Prepared by, and records the last saver", async () => {
    const v = await createVoucherForCheque(sql, "c1", TODAY, 1000, "Ana Reyes");
    expect(v).toMatchObject({ createdBy: "Ana Reyes", updatedBy: null, preparedBy: "Ana Reyes" });
    const saved = await updateVoucher(sql, v.id, { ...toInput(v), preparedBy: "Ana R." }, 2000, "Ben Cruz");
    expect(saved).toMatchObject({ createdBy: "Ana Reyes", updatedBy: "Ben Cruz", preparedBy: "Ana R." });
    const anon = await createVoucherForCheque(sql, "c2", TODAY);
    expect(anon).toMatchObject({ createdBy: null, preparedBy: "" });
  });
});
