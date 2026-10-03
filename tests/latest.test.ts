import { describe, expect, it } from "vitest";
import { latestOnly } from "@/lib/latest";

const later = <T,>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe("latestOnly", () => {
  it("marks a slow earlier response as stale when a later one was started", async () => {
    const track = latestOnly();
    const slow = track(later("old", 30));
    const fast = track(later("new", 1));
    expect(await fast).toEqual({ fresh: true, value: "new" });
    expect(await slow).toEqual({ fresh: false, value: "old" });
  });

  it("marks a lone response as fresh", async () => {
    const track = latestOnly();
    expect(await track(later(1, 1))).toEqual({ fresh: true, value: 1 });
  });
});
