/**
 * Foreground auto-run tick loop engine.
 * Per SPEC §7.4.2: user-initiated, sequential POST /tick calls.
 * NOT polling (§4.6) — this is a work-triggering loop.
 *
 * Uses setTimeout (not setInterval) so the next tick is only scheduled
 * after the previous tick completes — no concurrent requests.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutoRunError {
  code: string
  message: string
}

export interface AutoRunLoopOptions {
  /** URL to POST tick to. */
  url: string
  /** Called with parsed tick response on each successful tick. */
  onTick: (data: unknown) => void
  /** Return true if the run reached terminal status (stops the loop). */
  isTerminal: (data: unknown) => boolean
  /** Called when a tick error stops the loop. */
  onError: (err: AutoRunError) => void
  /** Called exactly once when the loop ends (any reason). */
  onStopped: () => void
  /** Delay (ms) between end of one tick and start of next. Default: 100. */
  delayMs?: number
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch
}

// ---------------------------------------------------------------------------
// Core auto-run loop engine (exported for direct testing without React/jsdom)
// ---------------------------------------------------------------------------

/**
 * Starts a foreground auto-run loop that sequentially POSTs to the tick endpoint.
 *
 * Stops on:
 * - Terminal run status (isTerminal returns true)
 * - First tick error (HTTP error or network error) — no auto-retry
 * - Manual stop() call (user clicks Stop or page unmounts)
 *
 * Returns a controller with a stop() method that aborts any in-flight
 * request and cancels the pending timer.
 */
export function startAutoRunLoop(options: AutoRunLoopOptions): { stop: () => void } {
  const {
    url,
    onTick,
    isTerminal,
    onError,
    onStopped,
    delayMs = 100,
    fetchFn = globalThis.fetch,
  } = options

  let ac: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function doStop() {
    if (stopped) return
    stopped = true
    if (timer !== null) { clearTimeout(timer); timer = null }
    if (ac) { ac.abort(); ac = null }
    onStopped()
  }

  async function tick() {
    if (stopped) return
    ac = new AbortController()
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: ac.signal,
      })
      if (stopped) return

      const data = await res.json()
      if (stopped) return

      if (!res.ok) {
        const apiErr = (data as { error?: { code?: string; message?: string } })?.error
        onError({
          code: apiErr?.code || 'UNKNOWN',
          message: apiErr?.message || `Tick failed (HTTP ${res.status})`,
        })
        doStop()
        return
      }

      onTick(data)

      if (isTerminal(data)) {
        doStop()
        return
      }

      if (!stopped) {
        timer = setTimeout(tick, delayMs)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (stopped) return
      onError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error during tick',
      })
      doStop()
    }
  }

  // Start first tick after delay (setTimeout, not immediate)
  timer = setTimeout(tick, delayMs)

  return { stop: () => doStop() }
}
