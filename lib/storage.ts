/** Which database to use. Production must never fall back to storage that resets. */
export function chooseStorage(env: { DATABASE_URL?: string; VERCEL?: string; NODE_ENV?: string }): "pg" | "pglite" {
  if (env.DATABASE_URL) return "pg";
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. The app will not run without its database.");
  }
  return "pglite";
}
