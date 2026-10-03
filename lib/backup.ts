import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { todayManila } from "./dates";

// Daily copies of the database in a "backups" folder next to it. Each copy is a complete,
// standalone SQLite file (VACUUM INTO), safe to take while the app is running.

export const KEEP_BACKUPS = 30;
const NAME = /^cheques-\d{4}-\d{2}-\d{2}\.db$/;

/** Writes today's backup unless it exists, then removes copies beyond KEEP_BACKUPS. */
export function createBackup(db: DatabaseSync, dbFile: string): string | null {
  const dir = path.join(path.dirname(dbFile), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const name = `cheques-${todayManila()}.db`;
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return null;
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const old = fs.readdirSync(dir).filter((n) => NAME.test(n)).sort().reverse().slice(KEEP_BACKUPS);
  for (const n of old) fs.rmSync(path.join(dir, n), { force: true });
  return name;
}

const globalForBackup = globalThis as unknown as { __chequesBackupTimer?: NodeJS.Timeout };

/** Makes today's backup now if missing, then checks again every hour. */
export function scheduleDailyBackups(db: DatabaseSync, dbFile: string) {
  if (globalForBackup.__chequesBackupTimer) return;
  const run = () => {
    try {
      createBackup(db, dbFile);
    } catch (err) {
      console.error("[backup] failed:", err);
    }
  };
  run();
  globalForBackup.__chequesBackupTimer = setInterval(run, 60 * 60 * 1000);
  globalForBackup.__chequesBackupTimer.unref?.();
}
