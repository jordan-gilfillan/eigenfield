/**
 * Advisory Lock Service
 *
 * Provides Postgres advisory locks for tick concurrency control.
 *
 * Spec reference: 7.4 (Concurrency guard)
 *
 * Advisory locks are session-scoped in Postgres. This implementation uses
 * a dedicated pg Pool (separate from Prisma's pool) to guarantee that lock
 * acquire and release happen on the same database connection.
 */

import { Pool } from 'pg'
import { TickInProgressError } from '../errors'

/**
 * Dedicated pool for advisory lock operations.
 * Lazy singleton — created on first use.
 */
let lockPool: Pool | null = null

function getLockPool(): Pool {
  if (!lockPool) {
    lockPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    })
  }
  return lockPool
}

/** Shuts down the lock pool. Exported for test cleanup. */
export async function closeLockPool(): Promise<void> {
  if (lockPool) {
    await lockPool.end()
    lockPool = null
  }
}

/**
 * Computes a stable int64 lock key from a run ID.
 * Uses a simple hash to convert the string ID to a number.
 */
export function computeLockKey(runId: string): bigint {
  // Simple hash: sum of char codes with position weighting
  let hash = BigInt(0)
  for (let i = 0; i < runId.length; i++) {
    hash = (hash * BigInt(31) + BigInt(runId.charCodeAt(i))) % BigInt(2 ** 63)
  }
  return hash
}

/**
 * Executes a function while holding an advisory lock.
 *
 * Uses a dedicated pg connection (not Prisma's pool) to guarantee the
 * lock is acquired and released on the same database session.
 *
 * @throws TickInProgressError if lock cannot be acquired
 */
export async function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = computeLockKey(runId)
  const pool = getLockPool()
  const client = await pool.connect()

  try {
    const { rows } = await client.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint)',
      [lockKey.toString()]
    )

    if (!rows[0].pg_try_advisory_lock) {
      throw new TickInProgressError()
    }

    try {
      return await fn()
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey.toString()])
      } catch {
        // If unlock fails (e.g., connection broken), the lock will be
        // released when the connection is cleaned up by Postgres.
      }
    }
  } finally {
    client.release()
  }
}
