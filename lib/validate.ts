import { isValidDate } from "./dates";
import { parseAmount } from "./money";
import { isCompany, type Company } from "./types";

export type NewChequeInput = {
  company: Company;
  chequeNo: string;
  payee: string;
  amount: number;
  issueDate: string;
  bankAccount: string;
  particulars: string;
  status: "issued" | "pending";
};

export type Validation = { ok: true; value: NewChequeInput } | { ok: false; errors: Record<string, string> };

const MAX = 200;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateNewCheque(raw: Record<string, unknown>): Validation {
  const errors: Record<string, string> = {};
  const chequeNo = text(raw.chequeNo);
  const payee = text(raw.payee);
  const bankAccount = text(raw.bankAccount);
  const particulars = text(raw.particulars);
  const amount = parseAmount(raw.amount);
  const status = raw.status ?? "issued";

  if (!isCompany(raw.company)) errors.company = "Choose a company.";
  if (!chequeNo) errors.chequeNo = "Enter the cheque no.";
  if (!payee) errors.payee = "Enter the payee.";
  if (amount === null) errors.amount = "Enter an amount above zero.";
  if (!isValidDate(raw.issueDate)) errors.issueDate = "Enter a valid cheque date.";
  if (status !== "issued" && status !== "pending") errors.status = "Choose issued or pending.";
  for (const [key, value] of Object.entries({ chequeNo, payee, bankAccount, particulars })) {
    if (value.length > MAX) errors[key] = `Keep this under ${MAX} characters.`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      company: raw.company as Company,
      chequeNo,
      payee,
      amount: amount!,
      issueDate: raw.issueDate as string,
      bankAccount,
      particulars,
      status: status as "issued" | "pending",
    },
  };
}
