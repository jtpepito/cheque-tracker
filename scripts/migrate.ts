// Applies new migration files. Usage: npm.cmd run migrate
import { migrate } from "../lib/migrate";
import { openTarget } from "./env";

async function main() {
  const { sql, label } = await openTarget(false);
  const applied = await migrate(sql);
  console.log(`Migrated the ${label}: ${applied.length ? applied.join(", ") : "nothing new to apply"}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);
