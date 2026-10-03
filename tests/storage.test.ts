import { describe, expect, it } from "vitest";
import { chooseStorage } from "@/lib/storage";

describe("chooseStorage", () => {
  it("uses Postgres when a database address is set", () => {
    expect(chooseStorage({ DATABASE_URL: "postgres://x", NODE_ENV: "production", VERCEL: "1" })).toBe("pg");
    expect(chooseStorage({ DATABASE_URL: "postgres://x", NODE_ENV: "development" })).toBe("pg");
  });
  it("uses the local database in development and tests", () => {
    expect(chooseStorage({ NODE_ENV: "development" })).toBe("pglite");
    expect(chooseStorage({ NODE_ENV: "test" })).toBe("pglite");
    expect(chooseStorage({})).toBe("pglite");
  });
  it("refuses to run in production or on Vercel without a database address", () => {
    expect(() => chooseStorage({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
    expect(() => chooseStorage({ VERCEL: "1", NODE_ENV: "development" })).toThrow(/DATABASE_URL/);
    expect(() => chooseStorage({ DATABASE_URL: "", NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });
});
