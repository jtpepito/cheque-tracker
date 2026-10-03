/** Sum of PHP amounts, added in centavos. A missing amount counts as zero. */
export function sumAmounts(amounts: Array<number | null>): number {
  let centavos = 0;
  for (const a of amounts) centavos += Math.round((a ?? 0) * 100);
  return centavos / 100;
}

/** A positive amount rounded to centavos, or null. Accepts "12,500.50" and "₱ 1,000". */
export function parseAmount(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const s = raw.replace(/[₱,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? rounded : null;
}

export function peso(n: number): string {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
