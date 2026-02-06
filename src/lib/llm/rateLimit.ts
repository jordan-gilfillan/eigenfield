/**
 * LLM Plumbing — Rate Limiter
 *
 * Await-based rate limiter enforcing a minimum delay between LLM calls.
 * No background intervals — fully deterministic and testable.
 *
 * The clock function is injectable for testing with fake timers.
 */

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export interface RateLimiterOptions {
  minDelayMs: number
  clock?: Clock
}

export class RateLimiter {
  private readonly minDelayMs: number
  private readonly clock: Clock
  private lastCallTime = 0
  private pending: Promise<void> = Promise.resolve()

  constructor(options: RateLimiterOptions) {
    this.minDelayMs = options.minDelayMs
    this.clock = options.clock ?? realClock
  }

  /**
   * Waits until the minimum delay has elapsed since the last call,
   * then records the current time. Serializes concurrent callers
   * so they take turns in FIFO order.
   */
  async acquire(): Promise<void> {
    // Chain onto the pending promise so callers are serialized
    const previous = this.pending
    let resolve!: () => void
    this.pending = new Promise<void>((r) => {
      resolve = r
    })

    try {
      await previous
      const now = this.clock.now()
      const elapsed = now - this.lastCallTime
      if (elapsed < this.minDelayMs) {
        await this.clock.sleep(this.minDelayMs - elapsed)
      }
      this.lastCallTime = this.clock.now()
    } finally {
      resolve()
    }
  }

  /**
   * Resets the limiter state (useful for testing).
   */
  reset(): void {
    this.lastCallTime = 0
    this.pending = Promise.resolve()
  }
}
