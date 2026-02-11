'use client'

import { useState, useRef, useCallback } from 'react'
import { startAutoRunLoop } from '../../hooks/useAutoRun'

interface Progress {
  queued: number
  running: number
  succeeded: number
  failed: number
  cancelled: number
}

interface StatusBarProps {
  runId: string
  runStatus: string
  progress: Progress
  totalJobs: number
  totalCostUsd: number
  onRefresh: () => Promise<void>
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed'])

export default function StatusBar({
  runId,
  runStatus,
  progress,
  totalJobs,
  totalCostUsd,
  onRefresh,
}: StatusBarProps) {
  const [tickInFlight, setTickInFlight] = useState(false)
  const [isAutoRunning, setIsAutoRunning] = useState(false)
  const [resumeInFlight, setResumeInFlight] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const autoRunRef = useRef<{ stop: () => void } | null>(null)

  const isTerminal = TERMINAL_STATUSES.has(runStatus)

  const handleTick = useCallback(async () => {
    if (tickInFlight || isAutoRunning || isTerminal) return
    setTickInFlight(true)
    setStatusError(null)
    try {
      const res = await fetch(`/api/distill/runs/${runId}/tick`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatusError(data.error?.message || `Tick failed (${res.status})`)
      }
      await onRefresh()
    } catch {
      setStatusError('Network error during tick.')
    } finally {
      setTickInFlight(false)
    }
  }, [runId, tickInFlight, isAutoRunning, isTerminal, onRefresh])

  const handleAutoRun = useCallback(() => {
    if (isAutoRunning) {
      autoRunRef.current?.stop()
      return
    }
    if (isTerminal) return

    setIsAutoRunning(true)
    setStatusError(null)
    autoRunRef.current = startAutoRunLoop({
      url: `/api/distill/runs/${runId}/tick`,
      onTick: () => {
        onRefresh()
      },
      isTerminal: (data) => {
        const status = (data as { runStatus: string }).runStatus
        return TERMINAL_STATUSES.has(status)
      },
      onError: (err) => {
        setStatusError(err.message)
      },
      onStopped: () => {
        setIsAutoRunning(false)
        autoRunRef.current = null
      },
    })
  }, [runId, isAutoRunning, isTerminal, onRefresh])

  const handleResume = useCallback(async () => {
    if (resumeInFlight || isTerminal) return
    setResumeInFlight(true)
    setStatusError(null)
    try {
      const res = await fetch(`/api/distill/runs/${runId}/resume`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setStatusError(data.error?.message || `Resume failed (${res.status})`)
      }
      await onRefresh()
    } catch {
      setStatusError('Network error during resume.')
    } finally {
      setResumeInFlight(false)
    }
  }, [runId, resumeInFlight, isTerminal, onRefresh])

  // Progress bar segments
  const total = totalJobs || 1
  const segments = [
    { key: 'succeeded', count: progress.succeeded, color: 'bg-green-500' },
    { key: 'failed', count: progress.failed, color: 'bg-red-400' },
    { key: 'running', count: progress.running, color: 'bg-blue-400' },
    { key: 'cancelled', count: progress.cancelled, color: 'bg-gray-300' },
    { key: 'queued', count: progress.queued, color: 'bg-gray-200' },
  ]

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      {/* Progress bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-2">
        {segments.map(
          (seg) =>
            seg.count > 0 && (
              <div
                key={seg.key}
                className={`${seg.color} transition-all duration-300`}
                style={{ width: `${(seg.count / total) * 100}%` }}
              />
            ),
        )}
      </div>

      {/* Counters + controls */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3 text-gray-500">
          <span>
            <span className="text-green-600 font-medium">{progress.succeeded}</span>/{totalJobs} done
          </span>
          {progress.failed > 0 && (
            <span className="text-red-500">{progress.failed} failed</span>
          )}
          {progress.running > 0 && (
            <span className="text-blue-500">{progress.running} running</span>
          )}
          <span>${totalCostUsd.toFixed(2)} total</span>
        </div>

        <div className="flex items-center gap-2">
          {statusError && (
            <span className="text-red-500 text-xs max-w-48 truncate" title={statusError}>
              {statusError}
            </span>
          )}

          {progress.failed > 0 && !isTerminal && (
            <button
              onClick={handleResume}
              disabled={resumeInFlight}
              className="px-2 py-1 text-xs rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resumeInFlight ? 'Resuming...' : 'Resume'}
            </button>
          )}

          <button
            onClick={handleTick}
            disabled={isTerminal || tickInFlight || isAutoRunning}
            className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tickInFlight ? 'Ticking...' : 'Tick'}
          </button>

          <button
            onClick={handleAutoRun}
            disabled={isTerminal && !isAutoRunning}
            className={`px-2 py-1 text-xs rounded border ${
              isAutoRunning
                ? 'border-blue-400 text-blue-600 bg-blue-50 hover:bg-blue-100'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isAutoRunning ? 'Stop' : 'Auto-run'}
          </button>
        </div>
      </div>
    </div>
  )
}
