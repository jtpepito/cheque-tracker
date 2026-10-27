import { describe, expect, it } from "vitest";
import { amountInWords } from "@/lib/words";

describe("amountInWords", () => {
  it("writes pesos and centavos the Philippine way, in capitals", () => {
    expect(amountInWords(106401.43)).toBe("ONE HUNDRED SIX THOUSAND FOUR HUNDRED ONE PESOS AND 43/100");
    expect(amountInWords(1)).toBe("ONE PESO AND 00/100");
    expect(amountInWords(1.5)).toBe("ONE PESO AND 50/100");
    expect(amountInWords(0.5)).toBe("ZERO PESOS AND 50/100");
    expect(amountInWords(0)).toBe("ZERO PESOS AND 00/100");
    expect(amountInWords(21)).toBe("TWENTY-ONE PESOS AND 00/100");
    expect(amountInWords(1015)).toBe("ONE THOUSAND FIFTEEN PESOS AND 00/100");
    expect(amountInWords(1000000)).toBe("ONE MILLION PESOS AND 00/100");
    expect(amountInWords(2000300.07)).toBe("TWO MILLION THREE HUNDRED PESOS AND 07/100");
    expect(amountInWords(999999999999.99)).toBe(
      "NINE HUNDRED NINETY-NINE BILLION NINE HUNDRED NINETY-NINE MILLION NINE HUNDRED NINETY-NINE THOUSAND NINE HUNDRED NINETY-NINE PESOS AND 99/100",
    );
  });
  it("rounds to centavos first, so 0.999 is one peso", () => {
    expect(amountInWords(0.999)).toBe("ONE PESO AND 00/100");
  });
  it("refuses a negative or unreadable amount", () => {
    expect(() => amountInWords(-1)).toThrow();
    expect(() => amountInWords(Number.NaN)).toThrow();
    expect(() => amountInWords(1e12)).toThrow();
  });
});
