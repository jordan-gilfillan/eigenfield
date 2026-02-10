/**
 * Tests for startAutoRunLoop — the core auto-run tick loop engine.
 * Per SPEC §7.4.2: sequential POST /tick, stop on first error, no auto-retry.
 *
 * Uses fake timers + injectable fetchFn so we stay in the node environment
 * (no jsdom / @testing-library needed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startAutoRunLoop } from '../../app/distill/hooks/useAutoRun'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okTickResponse(runStatus: string, processed = 1) {
  return {
    ok: true,
    json: () => Promise.resolve({
      runId: 'run-1',
      processed,
      jobs: [],
      progress: { queued: 1, running: 0, succeeded: 1, failed: 0, cancelled: 0 },
      runStatus,
    }),
  } as Response
}

function errorTickResponse(status: number, code = 'TICK_ERROR', message = 'Something went wrong') {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { code, message } }),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startAutoRunLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1) Sequential tick calls — no concurrent requests
  it('sends sequential tick calls with no overlap', async () => {
    let resolveFirst!: (value: Response) => void
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(okTickResponse('running'))
    const onTick = vi.fn()
    const onStopped = vi.fn()

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick,
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // First tick fires after delay, fetch starts (but doesn't resolve)
    await vi.advanceTimersByTimeAsync(50)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Advance well past another delay — no second fetch because first is pending
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Resolve first fetch
    resolveFirst(okTickResponse('running'))
    await vi.advanceTimersByTimeAsync(0) // flush microtasks
    expect(onTick).toHaveBeenCalledTimes(1)

    // Second tick scheduled after delay
    await vi.advanceTimersByTimeAsync(50)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(onTick).toHaveBeenCalledTimes(2)

    loop.stop()
  })

  // 2) Multiple successful ticks continue the loop
  it('continues through multiple successful ticks', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okTickResponse('running'))
    const onTick = vi.fn()

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick,
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped: vi.fn(),
      delayMs: 50,
      fetchFn,
    })

    // 3 ticks
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(3)

    loop.stop()
  })

  // 3) Sends POST with correct headers
  it('sends POST with JSON content-type and empty body', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okTickResponse('running'))

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped: vi.fn(),
      delayMs: 50,
      fetchFn,
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(fetchFn).toHaveBeenCalledWith('/api/tick', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: expect.any(AbortSignal),
    }))

    loop.stop()
  })

  // 4) Stop on terminal status
  it('stops when isTerminal returns true', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(okTickResponse('running'))
      .mockResolvedValue(okTickResponse('completed'))
    const onTick = vi.fn()
    const onStopped = vi.fn()

    startAutoRunLoop({
      url: '/api/tick',
      onTick,
      isTerminal: (data) => (data as { runStatus: string }).runStatus === 'completed',
      onError: vi.fn(),
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // First tick: running → continues
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(1)
    expect(onStopped).not.toHaveBeenCalled()

    // Second tick: completed → stops
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(2)
    expect(onStopped).toHaveBeenCalledTimes(1)

    // No more ticks
    await vi.advanceTimersByTimeAsync(500)
    expect(onTick).toHaveBeenCalledTimes(2)
  })

  // 5) Stop on first HTTP error — no auto-retry
  it('stops on first HTTP error and calls onError', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(okTickResponse('running'))
      .mockResolvedValue(errorTickResponse(500, 'LLM_PROVIDER_ERROR', 'Provider failed'))
    const onTick = vi.fn()
    const onError = vi.fn()
    const onStopped = vi.fn()

    startAutoRunLoop({
      url: '/api/tick',
      onTick,
      isTerminal: () => false,
      onError,
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // First tick: success
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(1)

    // Second tick: HTTP error → stops
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(1) // no new onTick call
    expect(onError).toHaveBeenCalledWith({
      code: 'LLM_PROVIDER_ERROR',
      message: 'Provider failed',
    })
    expect(onStopped).toHaveBeenCalledTimes(1)

    // No more ticks (no auto-retry)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  // 6) Stop on first network error — no auto-retry
  it('stops on network error and calls onError', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const onError = vi.fn()
    const onStopped = vi.fn()

    startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: () => false,
      onError,
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // First tick: network error → stops
    await vi.advanceTimersByTimeAsync(50)
    expect(onError).toHaveBeenCalledWith({
      code: 'NETWORK_ERROR',
      message: 'Failed to fetch',
    })
    expect(onStopped).toHaveBeenCalledTimes(1)

    // No retries
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  // 7) Abort in-flight request on stop()
  it('aborts in-flight request when stop() is called', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation((_url, init) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise<Response>(() => {}) // never resolves
      })

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped: vi.fn(),
      delayMs: 50,
      fetchFn,
    })

    await vi.advanceTimersByTimeAsync(50)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(capturedSignal?.aborted).toBe(false)

    loop.stop()
    expect(capturedSignal?.aborted).toBe(true)
  })

  // 8) onStopped called exactly once (even if stop() called after internal stop)
  it('onStopped is called exactly once', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okTickResponse('completed'))
    const onStopped = vi.fn()

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: (data) => (data as { runStatus: string }).runStatus === 'completed',
      onError: vi.fn(),
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // Internal stop on terminal
    await vi.advanceTimersByTimeAsync(50)
    expect(onStopped).toHaveBeenCalledTimes(1)

    // External stop() is a no-op (already stopped)
    loop.stop()
    expect(onStopped).toHaveBeenCalledTimes(1)
  })

  // 9) stop() before first tick prevents any fetch
  it('stop() before first tick prevents any fetch', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    const onStopped = vi.fn()

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped,
      delayMs: 100,
      fetchFn,
    })

    // Stop immediately before timer fires
    loop.stop()
    expect(onStopped).toHaveBeenCalledTimes(1)

    // Advance past when tick would have fired
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  // 10) stop() is safe to call multiple times
  it('stop() is idempotent', () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okTickResponse('running'))
    const onStopped = vi.fn()

    const loop = startAutoRunLoop({
      url: '/api/tick',
      onTick: vi.fn(),
      isTerminal: () => false,
      onError: vi.fn(),
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    loop.stop()
    loop.stop()
    loop.stop()
    expect(onStopped).toHaveBeenCalledTimes(1) // no double-call
  })

  // 11) Stops on failed terminal status (AUD-050: FAILED is terminal)
  it('stops when run reaches failed status', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okTickResponse('failed'))
    const onTick = vi.fn()
    const onStopped = vi.fn()

    startAutoRunLoop({
      url: '/api/tick',
      onTick,
      isTerminal: (data) => {
        const s = (data as { runStatus: string }).runStatus
        return s === 'completed' || s === 'cancelled' || s === 'failed'
      },
      onError: vi.fn(),
      onStopped,
      delayMs: 50,
      fetchFn,
    })

    // First tick: runStatus=failed → terminal → stops
    await vi.advanceTimersByTimeAsync(50)
    expect(onTick).toHaveBeenCalledTimes(1)
    expect(onStopped).toHaveBeenCalledTimes(1)

    // No further ticks
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
