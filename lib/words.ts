// Amounts in words for the printed voucher, Philippine style: "ONE PESO AND 50/100".

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const GROUPS = ["", "THOUSAND", "MILLION", "BILLION"];

/** 1 to 999 in words. */
function small(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`);
  const rest = n % 100;
  if (rest >= 20) parts.push(ONES[rest % 10] ? `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}` : TENS[Math.floor(rest / 10)]);
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) throw new Error(`Cannot write ${amount} in words.`);
  const centavos = Math.round(amount * 100);
  let pesos = Math.floor(centavos / 100);
  const cents = centavos % 100;
  const words: string[] = [];
  for (let g = 0; pesos > 0; g++) {
    const chunk = pesos % 1000;
    if (chunk) words.unshift(GROUPS[g] ? `${small(chunk)} ${GROUPS[g]}` : small(chunk));
    pesos = Math.floor(pesos / 1000);
  }
  const whole = Math.floor(centavos / 100);
  return `${words.length ? words.join(" ") : "ZERO"} ${whole === 1 ? "PESO" : "PESOS"} AND ${String(cents).padStart(2, "0")}/100`;
}
