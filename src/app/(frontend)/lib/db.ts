import pg from 'pg'

let dbPool: pg.Pool | null = null

/**
 * Shared database pool for frontend server components.
 * Tuned for serverless environments (Vercel):
 * - max: 5 connections (functions are short-lived)
 * - idle timeout: 10s (release unused connections quickly)
 * - connection timeout: 5s (fail fast if DB unreachable)
 */
export function getDb(): pg.Pool {
  if (!dbPool) {
    dbPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    })
  }
  return dbPool
}
