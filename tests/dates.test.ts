import { describe, expect, it } from "vitest";
import { addDays, isValidDate, shortDate, todayManila } from "@/lib/dates";

describe("todayManila", () => {
  it("uses the Manila date, not UTC", () => {
    // 3 Oct 2026 17:30 UTC is already 4 Oct, 1:30 AM in Manila.
    expect(todayManila(new Date("2026-10-03T17:30:00Z"))).toBe("2026-10-04");
    expect(todayManila(new Date("2026-10-03T15:59:00Z"))).toBe("2026-10-03");
  });
});

describe("addDays", () => {
  it("crosses month and year ends", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-03", 0)).toBe("2026-10-03");
  });
});

describe("isValidDate", () => {
  it("accepts real dates and rejects impossible or malformed ones", () => {
    expect(isValidDate("2026-10-03")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("3/10/2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
    expect(isValidDate(20261003)).toBe(false);
  });
});

describe("shortDate", () => {
  it("formats as weekday, day, month", () => {
    expect(shortDate("2026-10-03")).toBe("Sat, 3 Oct");
  });
});
