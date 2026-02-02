/**
 * Advisory Lock Service
 *
 * Provides Postgres advisory locks for tick concurrency control.
 *
 * Spec reference: 7.4 (Concurrency guard)
 *
 * Advisory locks are session-scoped in Postgres. This implementation uses
 * Prisma's $queryRawUnsafe to acquire and release locks on the same connection.
 *
 * Note: For production with connection pooling, a dedicated pg Pool should be
 * used for lock operations. This implementation works for single-connection
 * scenarios and Prisma's default behavior.
 */

import { prisma } from '../db'

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
 * Tries to acquire an advisory lock for a run.
 * Returns true if acquired, false if already held by another session.
 *
 * Uses pg_try_advisory_lock which is non-blocking.
 */
export async function tryAcquireLock(runId: string): Promise<boolean> {
  const lockKey = computeLockKey(runId)

  const result = await prisma.$queryRawUnsafe<[{ pg_try_advisory_lock: boolean }]>(
    `SELECT pg_try_advisory_lock($1)`,
    lockKey
  )

  return result[0].pg_try_advisory_lock
}

/**
 * Releases an advisory lock for a run.
 * Returns true if released, false if not held.
 */
export async function releaseLock(runId: string): Promise<boolean> {
  const lockKey = computeLockKey(runId)

  const result = await prisma.$queryRawUnsafe<[{ pg_advisory_unlock: boolean }]>(
    `SELECT pg_advisory_unlock($1)`,
    lockKey
  )

  return result[0].pg_advisory_unlock
}

/**
 * Executes a function while holding an advisory lock.
 * Automatically releases the lock when done (success or error).
 *
 * @throws Error with code TICK_IN_PROGRESS if lock cannot be acquired
 */
export async function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const acquired = await tryAcquireLock(runId)

  if (!acquired) {
    const error = new Error('Tick already in progress')
    ;(error as Error & { code: string }).code = 'TICK_IN_PROGRESS'
    throw error
  }

  try {
    return await fn()
  } finally {
    await releaseLock(runId)
  }
}
