import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkPasswordHash, hashPassword, normalizeUsername, passwordProblem, usernameProblem } from "@/lib/passwords";

describe("password hashing", () => {
  it("checks a password against its hash and nothing else", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(checkPasswordHash("correct horse battery", stored)).toBe(true);
    expect(checkPasswordHash("correct horse batter", stored)).toBe(false);
    expect(checkPasswordHash("correct horse battery", "nonsense")).toBe(false);
    expect(checkPasswordHash("correct horse battery", "")).toBe(false);
  });
  it("records the work factor in the hash and still checks hashes made with the earlier one", () => {
    expect(hashPassword("sample-pass-1").split("$")).toHaveLength(4);
    expect(hashPassword("sample-pass-1").split("$")[1]).toBe("65536");
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const legacy = `scrypt$${salt.toString("hex")}$${scryptSync("sample-pass-1", salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
    expect(checkPasswordHash("sample-pass-1", legacy)).toBe(true);
    expect(checkPasswordHash("sample-pass-2", legacy)).toBe(false);
    expect(checkPasswordHash("sample-pass-1", "scrypt$notanumber$00$00")).toBe(false);
  });
  it("salts, so the same password hashes differently each time", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("username and password rules", () => {
  it("normalises usernames to lower case", () => {
    expect(normalizeUsername("  Ana.Reyes ")).toBe("ana.reyes");
    expect(normalizeUsername(5)).toBe("");
  });
  it("accepts 3 to 30 characters of letters, digits, dot, underscore and dash", () => {
    expect(usernameProblem("ana")).toBeNull();
    expect(usernameProblem("ana.reyes_2-x")).toBeNull();
    expect(usernameProblem("ab")).toBe("Username: 3 to 30 characters, letters, digits, dots, underscores or dashes.");
    expect(usernameProblem("a".repeat(31))).not.toBeNull();
    expect(usernameProblem("ana reyes")).not.toBeNull();
    expect(usernameProblem("ana@x")).not.toBeNull();
    expect(usernameProblem(null)).not.toBeNull();
  });
  it("requires passwords of at least 8 characters", () => {
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("1234567")).toBe("Password: at least 8 characters.");
    expect(passwordProblem("")).not.toBeNull();
    expect(passwordProblem(undefined)).not.toBeNull();
    expect(passwordProblem("x".repeat(201))).toBe("Password: at most 200 characters.");
  });
});
