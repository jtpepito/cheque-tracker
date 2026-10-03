import { describe, expect, it } from "vitest";
import { checkSyncKey } from "@/lib/sync-key";

const KEY = "k".repeat(32);

describe("checkSyncKey", () => {
  it("accepts the right bearer key", () => {
    expect(checkSyncKey(`Bearer ${KEY}`, KEY)).toBe("ok");
  });
  it("rejects a wrong, malformed or missing key", () => {
    expect(checkSyncKey(`Bearer ${"x".repeat(32)}`, KEY)).toBe("wrong");
    expect(checkSyncKey(KEY, KEY)).toBe("wrong");
    expect(checkSyncKey("Bearer ", KEY)).toBe("wrong");
    expect(checkSyncKey(null, KEY)).toBe("wrong");
  });
  it("treats an unset or short server key as sync not set up, whatever is sent", () => {
    expect(checkSyncKey(`Bearer ${KEY}`, undefined)).toBe("unset");
    expect(checkSyncKey("Bearer short", "short")).toBe("unset");
    expect(checkSyncKey("Bearer ", "")).toBe("unset");
  });
});
