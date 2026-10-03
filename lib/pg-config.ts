import type { PoolConfig } from "pg";

/**
 * Settings for the pg pool.
 * - sslmode is removed from the connection string: pg lets the string override the ssl option
 *   below, and "sslmode=require" would then demand a certificate chain Node does not trust.
 * - With Supabase's CA certificate (DATABASE_CA_CERT) the server is verified. Without it the
 *   connection is still encrypted but the server is not verified.
 * - Timeouts make an unreachable database fail in seconds, not hang until the host kills the request.
 */
export function pgConfig(url: string, caCert?: string): PoolConfig {
  const [base, query = ""] = url.split("?");
  const kept = query
    .split("&")
    .filter((part) => part && !part.toLowerCase().startsWith("sslmode="))
    .join("&");
  const ca = caCert?.trim().replace(/\\n/g, "\n");
  return {
    connectionString: kept ? `${base}?${kept}` : base,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
    query_timeout: 20_000,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}
