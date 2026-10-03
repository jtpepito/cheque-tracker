import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scheduleDailyBackups } from "./backup";
import { PH_HOLIDAYS_2026 } from "./banking";
import { importIfPresent } from "./import";
import { DEFAULT_COMPANY_NAMES } from "./types";

// One SQLite connection per server process. Kept on globalThis so dev-mode hot reloads
// reuse it instead of opening a new handle on every edit.
const globalForDb = globalThis as unknown as { __chequesDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cheques (
  id            TEXT PRIMARY KEY,
  company       TEXT NOT NULL CHECK (company IN ('wwj','wythlae','wwjcorp','unassigned')),
  cheque_no     TEXT NOT NULL,
  payee         TEXT NOT NULL,
  amount        REAL,
  issue_date    TEXT NOT NULL,
  encoded_date  TEXT,
  bank_account  TEXT NOT NULL DEFAULT '',
  particulars   TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL CHECK (status IN ('pending','issued','cleared','voided')),
  created_at    INTEGER NOT NULL,
  imported      INTEGER NOT NULL DEFAULT 0,
  company_basis TEXT,
  source_row    INTEGER,
  company_locked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cheques_issue_date ON cheques(issue_date);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Days with no bank clearing, besides weekends.
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
`;

export function dbFile(): string {
  return process.env.CHEQUES_DB_PATH || path.join(process.cwd(), "data", "cheques.db");
}

export function openDatabase(file: string): DatabaseSync {
  const onDisk = file !== ":memory:";
  if (onDisk) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (onDisk) db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  // Databases made before the lock column existed.
  const columns = db.prepare("PRAGMA table_info(cheques)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "company_locked")) {
    db.exec("ALTER TABLE cheques ADD COLUMN company_locked INTEGER NOT NULL DEFAULT 0");
  }
  db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('companies', ?)").run(
    JSON.stringify(DEFAULT_COMPANY_NAMES),
  );
  // Seed the national holidays once, so a holiday removed in the page stays removed.
  const seeded = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('holidays_seeded', '2026')").run();
  if (seeded.changes > 0) {
    const insert = db.prepare("INSERT OR IGNORE INTO holidays (date, name) VALUES (?, ?)");
    for (const h of PH_HOLIDAYS_2026) insert.run(h.date, h.name);
  }
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__chequesDb) {
    const file = dbFile();
    const db = openDatabase(file);
    globalForDb.__chequesDb = db;
    scheduleDailyBackups(db, file);
    // A file placed next to the database is loaded once at startup (see README, "Loading cheques").
    try {
      const result = importIfPresent(db, path.join(path.dirname(file), "cheques-import.json"));
      if (result) console.log(result.summary);
    } catch (err) {
      console.error("[import] failed, nothing was loaded:", err);
    }
  }
  return globalForDb.__chequesDb;
}
