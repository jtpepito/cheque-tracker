import { describe, expect, it } from "vitest";
import { parseAmount, peso, sumAmounts } from "@/lib/money";

describe("sumAmounts", () => {
  it("adds in centavos so floats don't drift", () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([1000.55, 2000.45, 0.01])).toBe(3001.01);
  });
  it("treats a missing amount as zero", () => {
    expect(sumAmounts([100, null, 50])).toBe(150);
    expect(sumAmounts([])).toBe(0);
  });
});

describe("parseAmount", () => {
  it("accepts numbers and typed strings with commas or a peso sign", () => {
    expect(parseAmount(1500)).toBe(1500);
    expect(parseAmount("12,500.50")).toBe(12500.5);
    expect(parseAmount("₱ 1,000")).toBe(1000);
    expect(parseAmount("10.006")).toBe(10.01);
  });
  it("rejects anything that is not a positive amount", () => {
    for (const bad of ["abc", "", "0", "-5", 0, -1, null, undefined, Number.NaN, "1.2.3"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
});

describe("peso", () => {
  it("formats with a peso sign, commas and two decimals", () => {
    expect(peso(43403796.08)).toBe("₱43,403,796.08");
    expect(peso(0)).toBe("₱0.00");
  });
});
