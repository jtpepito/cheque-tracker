// Loads an import file. Usage: npm.cmd run load-cheques -- <file.json> [--local]
import fs from "node:fs";
import { importCheques, type ImportFile } from "../lib/import";
import { openTarget } from "./env";

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Usage: npm.cmd run load-cheques -- <file.json> [--local]");
  const { sql, label } = await openTarget(local);
  const result = await importCheques(sql, JSON.parse(fs.readFileSync(file, "utf8")) as ImportFile);
  console.log(`Loaded ${result.count} cheques into the ${label}.`);
  console.log(result.summary);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);
