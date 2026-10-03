/** The one way the app talks to its database. Implemented for pg (production) and PGlite (tests, local). */
export type Sql = {
  /** One statement with $1, $2 … parameters. Returns its rows. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** One or more statements without parameters (migrations). */
  exec(text: string): Promise<void>;
  /** Runs fn in one transaction on one connection; rolls back if it throws. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};
