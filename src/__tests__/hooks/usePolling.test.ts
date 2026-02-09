/**
 * Tests for startPollingLoop — the core scheduling engine behind usePolling.
 *
 * Uses fake timers + injectable fetchFn so we stay in the node environment
 * (no jsdom / @testing-library needed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startPollingLoop } from '../../app/distill/hooks/usePolling'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Response-like object accepted by startPollingLoop's json() call. */
function okResponse<T>(data: T) {
  return { ok: true, json: () => Promise.resolve(data) } as Response
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startPollingLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1) Schedules polling when started
  it('schedules a fetch after intervalMs and repeats', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okResponse({ v: 1 }))
    const onData = vi.fn()

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 1000,
      onData,
      fetchFn,
    })

    // Nothing happens before the first interval elapses
    expect(fetchFn).not.toHaveBeenCalled()

    // First tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/poll', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(onData).toHaveBeenCalledWith({ v: 1 })

    // Second tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenCalledTimes(2)

    loop.stop()
  })

  // 2) No concurrent requests — next tick waits for previous fetch
  it('does not overlap requests', async () => {
    let resolveFirst!: (value: Response) => void
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(okResponse({ v: 2 }))
    const onData = vi.fn()

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData,
      fetchFn,
    })

    // First tick fires, fetch starts (but doesn't resolve)
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Advance well past another interval — no second fetch because first is pending
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Resolve first fetch
    resolveFirst(okResponse({ v: 1 }))
    // Flush microtasks so the .json() chain completes and scheduleNext fires
    await vi.advanceTimersByTimeAsync(0)
    expect(onData).toHaveBeenCalledWith({ v: 1 })

    // Now the second tick should be scheduled
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenCalledWith({ v: 2 })

    loop.stop()
  })

  // 3) Aborts in-flight request on stop (simulates unmount / disable)
  it('aborts in-flight request when stop() is called', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockImplementation((_url, init) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise<Response>(() => {}) // never resolves
      })

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData: vi.fn(),
      fetchFn,
    })

    // Trigger first fetch
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(capturedSignal?.aborted).toBe(false)

    // Stop while in-flight
    loop.stop()
    expect(capturedSignal?.aborted).toBe(true)
  })

  // 4) Stops when onTerminal returns true
  it('stops polling when onTerminal returns true', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okResponse({ status: 'succeeded' }))
    const onData = vi.fn()
    const onTerminal = vi.fn().mockReturnValue(true)

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData,
      onTerminal,
      fetchFn,
    })

    // First tick
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledTimes(1)
    expect(onTerminal).toHaveBeenCalledWith({ status: 'succeeded' })

    // Should NOT schedule any more ticks
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    loop.stop() // cleanup
  })

  // 5) Calls onError for non-OK responses and continues polling
  it('calls onError on HTTP error and continues polling', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValue(okResponse({ recovered: true }))
    const onData = vi.fn()
    const onError = vi.fn()

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData,
      onError,
      fetchFn,
    })

    // First tick — HTTP 500
    await vi.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'HTTP 500' }))
    expect(onData).not.toHaveBeenCalled()

    // Second tick — recovers
    await vi.advanceTimersByTimeAsync(500)
    expect(onData).toHaveBeenCalledWith({ recovered: true })

    loop.stop()
  })

  // 6) Calls onError on network error and continues polling
  it('calls onError on network error and continues polling', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(okResponse({ ok: true }))
    const onData = vi.fn()
    const onError = vi.fn()

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData,
      onError,
      fetchFn,
    })

    // First tick — network error
    await vi.advanceTimersByTimeAsync(500)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Failed to fetch' }))

    // Second tick — succeeds
    await vi.advanceTimersByTimeAsync(500)
    expect(onData).toHaveBeenCalledWith({ ok: true })

    loop.stop()
  })

  // 7) stop() is idempotent — no errors on double-stop
  it('stop() is safe to call multiple times', async () => {
    const fetchFn = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(okResponse({ v: 1 }))

    const loop = startPollingLoop({
      url: '/api/poll',
      intervalMs: 500,
      onData: vi.fn(),
      fetchFn,
    })

    loop.stop()
    loop.stop() // no throw
  })
})
