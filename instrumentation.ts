// Runs once when the server starts. Opening the database here creates the tables, loads a
// waiting import file and starts the daily backups, instead of waiting for the first sign-in.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db");
    getDb();
  }
}
