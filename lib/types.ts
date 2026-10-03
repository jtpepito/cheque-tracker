export const COMPANIES = ["wwj", "wythlae", "wwjcorp", "unassigned"] as const;
export type Company = (typeof COMPANIES)[number];

export const STATUSES = ["pending", "issued", "cleared", "voided"] as const;
export type Status = (typeof STATUSES)[number];

export type Cheque = {
  id: string;
  company: Company;
  chequeNo: string;
  payee: string;
  /** PHP. Null only on two imported rows that have no amount in the source sheet. */
  amount: number | null;
  /** The cheque date, YYYY-MM-DD. Drives the calendar. Empty on imported rows that have none. */
  issueDate: string;
  /** The date logged in the sheet. Imported rows only. */
  encodedDate: string | null;
  bankAccount: string;
  particulars: string;
  status: Status;
  createdAt: number;
  imported: boolean;
  companyBasis: string | null;
  sourceRow: number | null;
};

export type CompanyNames = Record<Exclude<Company, "unassigned">, string>;

export const DEFAULT_COMPANY_NAMES: CompanyNames = {
  wwj: "WWJ Trading",
  wythlae: "Wythlae 1220",
  wwjcorp: "WWJ Corp",
};

export function isCompany(v: unknown): v is Company {
  return typeof v === "string" && (COMPANIES as readonly string[]).includes(v);
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export function companyLabel(names: CompanyNames, company: Company): string {
  return company === "unassigned" ? "Unassigned" : names[company];
}
