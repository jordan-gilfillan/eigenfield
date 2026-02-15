/**
 * Tests for Advisory Lock Service
 *
 * Spec reference: 7.4 (Concurrency guard)
 */

import { describe, it, expect, afterAll } from 'vitest'
import { computeLockKey, withLock, closeLockPool } from '../advisory-lock'
import { TickInProgressError } from '../../errors'

afterAll(async () => {
  await closeLockPool()
})

describe('advisory lock service', () => {
  describe('computeLockKey', () => {
    it('returns a stable bigint for the same input', () => {
      const key1 = computeLockKey('test-run-id')
      const key2 = computeLockKey('test-run-id')
      expect(key1).toBe(key2)
    })

    it('returns different keys for different inputs', () => {
      const key1 = computeLockKey('run-1')
      const key2 = computeLockKey('run-2')
      expect(key1).not.toBe(key2)
    })

    it('returns a bigint', () => {
      const key = computeLockKey('test')
      expect(typeof key).toBe('bigint')
    })
  })

  describe('withLock', () => {
    it('executes function while holding lock', async () => {
      const runId = `test-with-lock-${Date.now()}`
      let executed = false

      await withLock(runId, async () => {
        executed = true
        return 'result'
      })

      expect(executed).toBe(true)
    })

    it('returns result from function', async () => {
      const runId = `test-with-lock-result-${Date.now()}`

      const result = await withLock(runId, async () => {
        return { value: 42 }
      })

      expect(result).toEqual({ value: 42 })
    })

    it('two ticks contend; only one enters critical section', async () => {
      const runId = `test-contend-${Date.now()}`
      const entered: string[] = []

      let resolveHold!: () => void
      const holdPromise = new Promise<void>((r) => {
        resolveHold = r
      })
      let resolveAcquired!: () => void
      const acquiredPromise = new Promise<void>((r) => {
        resolveAcquired = r
      })

      // First: acquire lock and hold it
      const first = withLock(runId, async () => {
        entered.push('first')
        resolveAcquired()
        await holdPromise
        return 'first-done'
      })

      // Wait for first to signal it has the lock
      await acquiredPromise

      // Second: should fail because lock is held by a different connection
      const secondResult = await withLock(runId, async () => {
        entered.push('second')
        return 'second-done'
      }).catch((err) => err)

      expect(secondResult).toBeInstanceOf(TickInProgressError)
      expect((secondResult as TickInProgressError).code).toBe('TICK_IN_PROGRESS')

      // Release first
      resolveHold()
      const firstResult = await first
      expect(firstResult).toBe('first-done')

      expect(entered).toEqual(['first'])
    })

    it('releases lock even if function throws', async () => {
      const runId = `test-error-release-${Date.now()}`

      await expect(
        withLock(runId, async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      // Lock should be released — re-acquire should succeed
      const result = await withLock(runId, async () => 'recovered')
      expect(result).toBe('recovered')
    })

    it('releases lock after normal completion', async () => {
      const runId = `test-normal-release-${Date.now()}`

      await withLock(runId, async () => 'done')

      // Lock should be released — re-acquire should succeed
      const result = await withLock(runId, async () => 'again')
      expect(result).toBe('again')
    })
  })
})
