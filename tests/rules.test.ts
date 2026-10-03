import { describe, expect, it } from "vitest";
import { canTransition, nextStatuses } from "@/lib/rules";
import { STATUSES } from "@/lib/types";

describe("status rules", () => {
  it("allows only the three moves in the spec", () => {
    const allowed = STATUSES.flatMap((from) =>
      STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}>${to}`),
    );
    expect(allowed.sort()).toEqual(["issued>cleared", "issued>voided", "pending>issued"]);
  });
  it("lists the next statuses for the row buttons", () => {
    expect(nextStatuses("pending")).toEqual(["issued"]);
    expect(nextStatuses("issued")).toEqual(["cleared", "voided"]);
    expect(nextStatuses("cleared")).toEqual([]);
    expect(nextStatuses("voided")).toEqual([]);
  });
});
