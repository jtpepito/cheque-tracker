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

/**
 * A bank balance rounded to centavos, or null. Unlike a cheque amount it may be zero or
 * negative (an overdrawn account). Accepts "1,250,000.50", "₱ 12,500" and "-5,000.25".
 */
export function parseBalance(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const s = raw.replace(/[₱,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  // The database column holds up to 12 digits before the decimal point.
  if (!Number.isFinite(n) || Math.abs(n) >= 1e12) return null;
  return Math.round(n * 100) / 100;
}

export function peso(n: number): string {
  const text = Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "−₱" : "₱") + text;
}
