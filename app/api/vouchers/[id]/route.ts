import { NextResponse } from "next/server";
import { getCompanyNames, listCheques } from "@/lib/cheques";
import { getSql } from "@/lib/db";
import { badRequest, guarded, readObject } from "@/lib/http";
import { companyLabel } from "@/lib/types";
import { deleteVoucher, getCompanyDetails, getVoucher, updateVoucher, validateVoucherInput } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "This voucher no longer exists." }, { status: 404 });

export function GET(_req: Request, { params }: Params) {
  return guarded(async () => {
    const { id } = await params;
    const sql = await getSql();
    const voucher = await getVoucher(sql, id);
    if (!voucher) return notFound();
    const cheque = voucher.chequeId ? ((await listCheques(sql)).find((c) => c.id === voucher.chequeId) ?? null) : null;
    const [names, details] = await Promise.all([getCompanyNames(sql), getCompanyDetails(sql)]);
    return NextResponse.json({
      voucher,
      cheque: cheque ? { chequeNo: cheque.chequeNo, bankAccount: cheque.bankAccount, issueDate: cheque.issueDate, status: cheque.status } : null,
      companyName: companyLabel(names, voucher.company),
      details: details[voucher.company],
    });
  });
}

export function PUT(req: Request, { params }: Params) {
  return guarded(async (user) => {
    const { id } = await params;
    const v = validateVoucherInput(await readObject(req));
    if (!v.ok) return badRequest("Fix the highlighted fields.", v.errors);
    return NextResponse.json(await updateVoucher(await getSql(), id, v.value, Date.now(), user.name));
  });
}

export function DELETE(_req: Request, { params }: Params) {
  return guarded(async () => {
    const { id } = await params;
    await deleteVoucher(await getSql(), id);
    return NextResponse.json({ id });
  });
}
