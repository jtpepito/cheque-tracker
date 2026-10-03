import { describe, expect, it } from "vitest";
import { pgConfig } from "@/lib/pg-config";

const URL_PLAIN = "postgresql://user.ref:pw@pooler.example.com:6543/postgres";

describe("pgConfig", () => {
  it("keeps the connection string and sets timeouts so a dead database fails fast", () => {
    const c = pgConfig(URL_PLAIN);
    expect(c.connectionString).toBe(URL_PLAIN);
    expect(c.connectionTimeoutMillis).toBe(8000);
    expect(c.query_timeout).toBe(20000);
    expect(c.max).toBe(3);
  });

  it("removes sslmode from the string, because it would override the ssl setting below", () => {
    expect(pgConfig(URL_PLAIN + "?sslmode=require").connectionString).toBe(URL_PLAIN);
    expect(pgConfig(URL_PLAIN + "?sslmode=require&application_name=x").connectionString).toBe(URL_PLAIN + "?application_name=x");
    expect(pgConfig(URL_PLAIN + "?application_name=x&sslmode=verify-full").connectionString).toBe(URL_PLAIN + "?application_name=x");
  });

  it("verifies the server against the given certificate when one is supplied", () => {
    expect(pgConfig(URL_PLAIN, "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----").ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("accepts a certificate pasted with \\n in place of line breaks", () => {
    expect(pgConfig(URL_PLAIN, "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----").ssl).toMatchObject({
      ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
    });
  });

  it("still encrypts, without verifying, when no certificate is supplied", () => {
    expect(pgConfig(URL_PLAIN).ssl).toEqual({ rejectUnauthorized: false });
    expect(pgConfig(URL_PLAIN, "  ").ssl).toEqual({ rejectUnauthorized: false });
  });
});
