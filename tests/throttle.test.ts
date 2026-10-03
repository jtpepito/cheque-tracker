import { describe, expect, it } from "vitest";
import { createThrottle } from "@/lib/throttle";

describe("createThrottle", () => {
  it("blocks a key after too many failures inside the window", () => {
    const t = createThrottle(3, 1000);
    expect(t.blocked("a", 0)).toBe(false);
    t.fail("a", 0);
    t.fail("a", 100);
    expect(t.blocked("a", 150)).toBe(false);
    t.fail("a", 200);
    expect(t.blocked("a", 250)).toBe(true);
    expect(t.blocked("b", 250)).toBe(false);
  });

  it("lets the key try again once the window has passed", () => {
    const t = createThrottle(2, 1000);
    t.fail("a", 0);
    t.fail("a", 10);
    expect(t.blocked("a", 500)).toBe(true);
    expect(t.blocked("a", 1011)).toBe(false);
  });

  it("forgets failures after a success", () => {
    const t = createThrottle(2, 1000);
    t.fail("a", 0);
    t.fail("a", 1);
    t.reset("a");
    expect(t.blocked("a", 2)).toBe(false);
  });
});
