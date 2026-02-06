import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../lib/llm/rateLimit'
import type { Clock } from '../lib/llm/rateLimit'

/**
 * Fake clock for deterministic testing.
 * Tracks current time and records sleep calls.
 */
function fakeClock(startTime = 0) {
  let time = startTime
  const sleepCalls: number[] = []

  const clock: Clock = {
    now() {
      return time
    },
    async sleep(ms: number) {
      sleepCalls.push(ms)
      time += ms
    },
  }

  return {
    clock,
    get time() {
      return time
    },
    set time(t: number) {
      time = t
    },
    sleepCalls,
  }
}

describe('RateLimiter', () => {
  it('first call does not wait', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 250, clock: fc.clock })

    await limiter.acquire()
    expect(fc.sleepCalls).toHaveLength(0)
  })

  it('second call waits the full delay if called immediately', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 250, clock: fc.clock })

    await limiter.acquire()
    // Time is still 1000 (no sleep)
    await limiter.acquire()
    expect(fc.sleepCalls).toEqual([250])
  })

  it('does not wait if enough time has passed', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 250, clock: fc.clock })

    await limiter.acquire()
    // Simulate time passing
    fc.time = 1300
    await limiter.acquire()
    expect(fc.sleepCalls).toHaveLength(0)
  })

  it('waits only the remaining delay', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 250, clock: fc.clock })

    await limiter.acquire()
    // 100ms has passed since last call
    fc.time = 1100
    await limiter.acquire()
    // Should sleep for 150ms (250 - 100)
    expect(fc.sleepCalls).toEqual([150])
  })

  it('serializes concurrent callers (FIFO order)', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 100, clock: fc.clock })

    const order: number[] = []

    // Launch 3 concurrent acquires
    const p1 = limiter.acquire().then(() => order.push(1))
    const p2 = limiter.acquire().then(() => order.push(2))
    const p3 = limiter.acquire().then(() => order.push(3))

    await Promise.all([p1, p2, p3])

    // All three should complete in FIFO order
    expect(order).toEqual([1, 2, 3])
  })

  it('concurrent callers each wait the full delay', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 100, clock: fc.clock })

    await limiter.acquire() // First call, no wait
    // Two rapid concurrent calls
    const p1 = limiter.acquire()
    const p2 = limiter.acquire()
    await Promise.all([p1, p2])

    // Each should have caused a sleep
    expect(fc.sleepCalls.length).toBe(2)
  })

  it('zero delay means no waiting', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 0, clock: fc.clock })

    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    expect(fc.sleepCalls).toHaveLength(0)
  })

  it('reset clears state', async () => {
    const fc = fakeClock(1000)
    const limiter = new RateLimiter({ minDelayMs: 250, clock: fc.clock })

    await limiter.acquire()
    limiter.reset()
    // After reset, next call should not wait
    await limiter.acquire()
    expect(fc.sleepCalls).toHaveLength(0)
  })
})
