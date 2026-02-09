/**
 * Reusable foreground polling hook and its underlying loop engine.
 *
 * Uses setTimeout (not setInterval) so the next tick is only scheduled
 * after the previous fetch completes — no concurrent requests.
 */

import { useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UsePollingOptions<T> {
  /** URL to poll. Null disables polling. */
  url: string | null
  /** Milliseconds between the end of one fetch and the start of the next. */
  intervalMs: number
  /** Master on/off switch. When false, any in-flight request is aborted. */
  enabled: boolean
  /** Called with parsed JSON on each successful fetch. */
  onData: (data: T) => void
  /** Return true to stop polling (terminal state reached). */
  onTerminal?: (data: T) => boolean
  /** Called on fetch errors (network, non-OK status). Not called on abort. */
  onError?: (error: Error) => void
  /** Extra RequestInit options merged into each fetch call. */
  fetchInit?: RequestInit
}

// ---------------------------------------------------------------------------
// Core polling engine (exported for direct testing without React/jsdom)
// ---------------------------------------------------------------------------

export interface PollingLoopOptions<T> {
  url: string
  intervalMs: number
  onData: (data: T) => void
  onTerminal?: (data: T) => boolean
  onError?: (error: Error) => void
  fetchInit?: RequestInit
  /** Injectable fetch for testing. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch
}

/**
 * Starts a polling loop that calls `fetch(url)` on a setTimeout cadence.
 * Returns a controller with a `stop` method that aborts any in-flight
 * request and cancels the pending timer.
 */
export function startPollingLoop<T>(options: PollingLoopOptions<T>): { stop: () => void } {
  const {
    url,
    intervalMs,
    onData,
    onTerminal,
    onError,
    fetchInit,
    fetchFn = globalThis.fetch,
  } = options

  let ac: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function scheduleNext() {
    if (stopped) return
    timer = setTimeout(async () => {
      if (stopped) return
      ac = new AbortController()
      try {
        const res = await fetchFn(url, { ...fetchInit, signal: ac.signal })
        if (stopped || ac.signal.aborted) return
        if (!res.ok) {
          onError?.(new Error(`HTTP ${res.status}`))
          scheduleNext()
          return
        }
        const data: T = await res.json()
        if (stopped || ac.signal.aborted) return
        onData(data)
        if (onTerminal?.(data)) return
        scheduleNext()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (stopped) return
        onError?.(err instanceof Error ? err : new Error(String(err)))
        scheduleNext()
      }
    }, intervalMs)
  }

  scheduleNext()

  return {
    stop() {
      stopped = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (ac) {
        ac.abort()
        ac = null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Polls `url` on a setTimeout cadence while `enabled` is true.
 * Aborts in-flight requests on unmount or when `enabled`/`url` changes.
 */
export function usePolling<T>(options: UsePollingOptions<T>): void {
  const { url, intervalMs, enabled } = options

  // Store callbacks in refs so the effect doesn't re-fire on every render.
  const onDataRef = useRef(options.onData)
  const onTerminalRef = useRef(options.onTerminal)
  const onErrorRef = useRef(options.onError)
  const fetchInitRef = useRef(options.fetchInit)
  onDataRef.current = options.onData
  onTerminalRef.current = options.onTerminal
  onErrorRef.current = options.onError
  fetchInitRef.current = options.fetchInit

  useEffect(() => {
    if (!enabled || !url) return

    const loop = startPollingLoop<T>({
      url,
      intervalMs,
      onData: (data) => onDataRef.current(data),
      onTerminal: (data) => onTerminalRef.current?.(data) ?? false,
      onError: (err) => onErrorRef.current?.(err),
      fetchInit: fetchInitRef.current,
    })

    return () => loop.stop()
  }, [enabled, url, intervalMs])
}
