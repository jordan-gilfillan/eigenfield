'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { OutputViewer } from './components/OutputViewer'
import { InputViewer } from './components/InputViewer'
import { usePolling } from '../../hooks/usePolling'
import { getClassifyStatusColor, getStatusColor, getJobStatusColor, formatProgressPercent } from '../../lib/ui-utils'
import type { LastClassifyStats } from '../../lib/types'

const RUN_POLL_INTERVAL_MS = 3000

interface RunConfig {
  promptVersionIds: { summarize: string }
  labelSpec: { model: string; promptVersionId: string }
  filterProfile: { name: string; mode: string; categories: string[] }
  timezone: string
  maxInputTokens: number
}

interface RunProgress {
  queued: number
  running: number
  succeeded: number
  failed: number
  cancelled: number
}

interface RunTotals {
  jobs: number
  tokensIn: number
  tokensOut: number
  costUsd: number
}

interface JobDetail {
  dayDate: string
  status: string
  attempt: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  error: string | null
}

interface ImportBatchInfo {
  id: string
  originalFilename: string
  source: string
}

interface RunDetail {
  id: string
  status: string
  importBatchId: string
  importBatchIds?: string[]
  importBatches?: ImportBatchInfo[]
  model: string
  sources: string[]
  startDate: string
  endDate: string
  config: RunConfig
  progress: RunProgress
  totals: RunTotals
  jobs: JobDetail[]
  createdAt: string
}

interface ApiError {
  error: {
    code: string
    message: string
  }
}

interface TickResult {
  runId: string
  processed: number
  jobs: Array<{
    dayDate: string
    status: string
    attempt: number
    tokensIn: number | null
    tokensOut: number | null
    costUsd: number | null
    error: string | null
  }>
  progress: {
    queued: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
  }
  runStatus: string
}

interface TickError {
  code: string
  message: string
}

type LoadingState = 'loading' | 'success' | 'error'

export default function RunDetailPage() {
  const params = useParams()
  const runId = params.runId as string

  const [loadingState, setLoadingState] = useState<LoadingState>('loading')
  const [run, setRun] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resettingDay, setResettingDay] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)

  // Tick state
  const [tickInFlight, setTickInFlight] = useState(false)
  const [lastTickResult, setLastTickResult] = useState<TickResult | null>(null)
  const [lastTickError, setLastTickError] = useState<TickError | null>(null)

  // Resume state
  const [resumeInFlight, setResumeInFlight] = useState(false)
  const [lastResumeResult, setLastResumeResult] = useState<{ jobsRequeued: number; status: string } | null>(null)
  const [lastResumeError, setLastResumeError] = useState<TickError | null>(null)

  // Cancel state
  const [cancelInFlight, setCancelInFlight] = useState(false)
  const [lastCancelResult, setLastCancelResult] = useState<{ jobsCancelled: number; status: string } | null>(null)
  const [lastCancelError, setLastCancelError] = useState<TickError | null>(null)

  // Last classify stats (same shared endpoint as dashboard)
  const [lastClassifyStats, setLastClassifyStats] = useState<LastClassifyStats | null>(null)
  const [refreshingClassifyStats, setRefreshingClassifyStats] = useState(false)
  const [classifyStatsError, setClassifyStatsError] = useState<string | null>(null)

  // Collapsible frozen config
  const [configCollapsed, setConfigCollapsed] = useState(false)

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/distill/runs/${runId}`)
      const data = await res.json()

      if (!res.ok) {
        const apiError = data as ApiError
        setError(apiError.error?.message || 'Failed to load run')
        setLoadingState('error')
        return
      }

      setRun(data as RunDetail)
      setLoadingState('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run')
      setLoadingState('error')
    }
  }, [runId])

  useEffect(() => {
    fetchRun()
  }, [fetchRun])

  // Auto-poll run detail when non-terminal (queued/running/processing)
  const isTerminal = run?.status === 'cancelled' || run?.status === 'completed'
  usePolling<RunDetail>({
    url: `/api/distill/runs/${runId}`,
    intervalMs: RUN_POLL_INTERVAL_MS,
    enabled: loadingState === 'success' && !!run && !isTerminal,
    onData: (data) => setRun(data),
    onTerminal: (data) => data.status === 'cancelled' || data.status === 'completed',
  })

  const fetchLastClassifyStats = useCallback(async () => {
    if (!run) return
    const labelSpec = run.config.labelSpec
    if (!labelSpec?.model || !labelSpec?.promptVersionId) return

    setClassifyStatsError(null)
    try {
      const res = await fetch(
        `/api/distill/import-batches/${run.importBatchId}/last-classify?model=${encodeURIComponent(labelSpec.model)}&promptVersionId=${encodeURIComponent(labelSpec.promptVersionId)}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setClassifyStatsError(data.error?.message || `Failed to load classify stats (${res.status})`)
        return
      }
      const data: LastClassifyStats = await res.json()
      setLastClassifyStats(data)
    } catch (err) {
      setClassifyStatsError(err instanceof Error ? err.message : 'Failed to load classify stats')
    }
  }, [run])

  // Fetch last classify stats once run is loaded (page load only, no polling)
  useEffect(() => {
    fetchLastClassifyStats()
  }, [fetchLastClassifyStats])

  const handleRefreshLastClassifyStats = useCallback(async () => {
    setRefreshingClassifyStats(true)
    try {
      await fetchLastClassifyStats()
    } finally {
      setRefreshingClassifyStats(false)
    }
  }, [fetchLastClassifyStats])

  const handleResetJob = async (dayDate: string) => {
    setResettingDay(dayDate)
    setResetError(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/jobs/${dayDate}/reset`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        const apiError = data as ApiError
        setResetError(apiError.error?.message || 'Failed to reset job')
        setResettingDay(null)
        return
      }

      // Re-fetch run to show updated job state
      await fetchRun()
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset job')
    } finally {
      setResettingDay(null)
    }
  }

  /**
   * Handle tick button click.
   * CRITICAL: This function prevents overlapping tick requests by:
   * 1. Disabling the button via tickInFlight state
   * 2. Awaiting the response before allowing another tick
   * Per spec 7.4: UI must be sequential, no overlapping ticks
   */
  const handleTick = async () => {
    // Prevent overlapping tick requests (UI invariant)
    if (tickInFlight) return

    setTickInFlight(true)
    setLastTickError(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (!res.ok) {
        const apiError = data as ApiError
        setLastTickError({
          code: apiError.error?.code || 'UNKNOWN',
          message: apiError.error?.message || 'Tick failed',
        })
        return
      }

      // Store the successful tick result
      setLastTickResult(data as TickResult)

      // Re-fetch run details to update job table and progress
      await fetchRun()
    } catch (err) {
      setLastTickError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error during tick',
      })
    } finally {
      // CRITICAL: Only set tickInFlight to false after request completes
      // This ensures sequential tick requests per spec
      setTickInFlight(false)
    }
  }

  const handleResume = async () => {
    if (resumeInFlight) return

    setResumeInFlight(true)
    setLastResumeError(null)
    setLastResumeResult(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/resume`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        const apiError = data as ApiError
        setLastResumeError({
          code: apiError.error?.code || 'UNKNOWN',
          message: apiError.error?.message || 'Resume failed',
        })
        return
      }

      setLastResumeResult({ jobsRequeued: data.jobsRequeued, status: data.status })
      await fetchRun()
    } catch (err) {
      setLastResumeError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error during resume',
      })
    } finally {
      setResumeInFlight(false)
    }
  }

  const handleCancel = async () => {
    if (cancelInFlight) return

    setCancelInFlight(true)
    setLastCancelError(null)
    setLastCancelResult(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/cancel`, {
        method: 'POST',
      })
      const data = await res.json()

      if (!res.ok) {
        const apiError = data as ApiError
        setLastCancelError({
          code: apiError.error?.code || 'UNKNOWN',
          message: apiError.error?.message || 'Cancel failed',
        })
        return
      }

      setLastCancelResult({ jobsCancelled: data.jobsCancelled, status: data.status })
      await fetchRun()
    } catch (err) {
      setLastCancelError({
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error during cancel',
      })
    } finally {
      setCancelInFlight(false)
    }
  }

  if (loadingState === 'loading') {
    return (
      <main className="min-h-screen p-8 max-w-6xl mx-auto">
        <div className="text-gray-500">Loading run details...</div>
      </main>
    )
  }

  if (loadingState === 'error' || !run) {
    return (
      <main className="min-h-screen p-8 max-w-6xl mx-auto">
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700">{error || 'Run not found'}</p>
        </div>
      </main>
    )
  }

  const completedJobs = run.progress.succeeded + run.progress.failed + run.progress.cancelled
  const completionPercent = run.totals.jobs > 0
    ? Math.min(100, Math.round((completedJobs / run.totals.jobs) * 100))
    : 100

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-3xl font-bold mb-1">Run Detail</h1>
        <div className="text-sm text-gray-500">
          ID: <code className="bg-gray-100 px-1 rounded">{run.id}</code>
          {' \u00b7 '}
          Created {new Date(run.createdAt).toLocaleString()}
        </div>
      </div>

      {/* Status Rail */}
      <div className="p-4 bg-white border border-gray-200 rounded-md shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <span className={`px-3 py-1 rounded text-sm font-semibold ${getStatusColor(run.status)}`}>
            {run.status}
          </span>
          <span className="text-sm text-gray-600">
            {completedJobs} / {run.totals.jobs} jobs complete ({completionPercent}%)
          </span>
        </div>
        {run.totals.jobs > 0 && (
          <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {run.progress.queued > 0 && <span className="text-gray-600">Queued: {run.progress.queued}</span>}
          {run.progress.running > 0 && <span className="text-blue-600">Running: {run.progress.running}</span>}
          {run.progress.succeeded > 0 && <span className="text-green-600">Succeeded: {run.progress.succeeded}</span>}
          {run.progress.failed > 0 && <span className="text-red-600">Failed: {run.progress.failed}</span>}
          {run.progress.cancelled > 0 && <span className="text-yellow-600">Cancelled: {run.progress.cancelled}</span>}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-4 text-sm text-gray-600">
          <span>Tokens In: {run.totals.tokensIn.toLocaleString()}</span>
          <span>Tokens Out: {run.totals.tokensOut.toLocaleString()}</span>
          <span>Cost: ${run.totals.costUsd.toFixed(4)}</span>
        </div>
      </div>

      {/* Run Controls — immediately below status rail per UX_SPEC §4.4 */}
      <RunControls
        run={run}
        tickInFlight={tickInFlight}
        lastTickResult={lastTickResult}
        lastTickError={lastTickError}
        onTick={handleTick}
        resumeInFlight={resumeInFlight}
        lastResumeResult={lastResumeResult}
        lastResumeError={lastResumeError}
        onResume={handleResume}
        cancelInFlight={cancelInFlight}
        lastCancelResult={lastCancelResult}
        lastCancelError={lastCancelError}
        onCancel={handleCancel}
      />

      {/* Frozen Config (collapsible — starts expanded) */}
      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
        <button
          onClick={() => setConfigCollapsed(!configCollapsed)}
          className="w-full flex items-center gap-2 text-left"
        >
          <span className="text-sm text-blue-600">{configCollapsed ? '\u25b6' : '\u25bc'}</span>
          <h2 className="text-lg font-semibold text-blue-800">Frozen Config</h2>
          {configCollapsed && (
            <span className="text-sm text-blue-600 ml-auto">Click to expand</span>
          )}
        </button>
        {!configCollapsed && (
          <>
            <p className="text-xs text-blue-600 mb-4 mt-2">
              These values are frozen at run creation and will not change.
            </p>
            <FrozenConfigBlock config={run.config} />
          </>
        )}
      </div>

      {/* Last Classify Stats (shared endpoint with dashboard) */}
      {lastClassifyStats && lastClassifyStats.hasStats && lastClassifyStats.stats && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-blue-800">Last Classify Stats</h2>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${getClassifyStatusColor(lastClassifyStats.stats.status)}`}
            >
              {lastClassifyStats.stats.status}
            </span>
            <button
              onClick={handleRefreshLastClassifyStats}
              disabled={refreshingClassifyStats}
              className={`ml-auto px-2 py-1 rounded text-xs font-medium ${
                refreshingClassifyStats
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-700 text-white hover:bg-blue-800'
              }`}
            >
              {refreshingClassifyStats ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm text-blue-700">
            <div>
              <span className="font-medium">Total Atoms:</span> {lastClassifyStats.stats.totalAtoms}
            </div>
            <div>
              <span className="font-medium">Processed Atoms:</span> {lastClassifyStats.stats.processedAtoms}
            </div>
            <div>
              <span className="font-medium">Labeled Total:</span> {lastClassifyStats.stats.labeledTotal}
            </div>
            <div>
              <span className="font-medium">Newly Labeled:</span> {lastClassifyStats.stats.newlyLabeled}
            </div>
            <div>
              <span className="font-medium">Skipped (already):</span> {lastClassifyStats.stats.skippedAlreadyLabeled}
            </div>
            <div>
              <span className="font-medium">Skipped (bad output):</span> {lastClassifyStats.stats.skippedBadOutput}
            </div>
            <div>
              <span className="font-medium">Aliased category count:</span> {lastClassifyStats.stats.aliasedCount}
            </div>
            {lastClassifyStats.stats.status === 'running' && (
              <div className="col-span-3 font-medium">
                Progress: {lastClassifyStats.stats.processedAtoms}/{lastClassifyStats.stats.totalAtoms}{' '}
                ({formatProgressPercent(lastClassifyStats.stats.processedAtoms, lastClassifyStats.stats.totalAtoms)}%)
              </div>
            )}
            <div>
              <span className="font-medium">Mode:</span> {lastClassifyStats.stats.mode}
            </div>
            <div>
              <span className="font-medium">Classified at:</span>{' '}
              {new Date(lastClassifyStats.stats.finishedAt ?? lastClassifyStats.stats.createdAt).toLocaleString()}
            </div>
            {lastClassifyStats.stats.tokensIn !== null && (
              <div>
                <span className="font-medium">Tokens In:</span> {lastClassifyStats.stats.tokensIn.toLocaleString()}
              </div>
            )}
            {lastClassifyStats.stats.tokensOut !== null && (
              <div>
                <span className="font-medium">Tokens Out:</span> {lastClassifyStats.stats.tokensOut.toLocaleString()}
              </div>
            )}
            {lastClassifyStats.stats.costUsd !== null && (
              <div>
                <span className="font-medium">Cost:</span> ${lastClassifyStats.stats.costUsd.toFixed(4)}
              </div>
            )}
            {lastClassifyStats.stats.status === 'failed' && lastClassifyStats.stats.errorJson && (
              <div className="col-span-3 text-red-700 bg-red-50 border border-red-200 rounded p-2">
                <span className="font-medium">Error [{lastClassifyStats.stats.errorJson.code}]</span>{' '}
                {lastClassifyStats.stats.errorJson.message}
              </div>
            )}
          </div>
        </div>
      )}
      {classifyStatsError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{classifyStatsError}</p>
        </div>
      )}
      {lastClassifyStats && !lastClassifyStats.hasStats && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-gray-500">No classify stats available for this run&apos;s label spec.</p>
          <button
            onClick={handleRefreshLastClassifyStats}
            disabled={refreshingClassifyStats}
            className={`px-2 py-1 rounded text-xs font-medium ${
              refreshingClassifyStats
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-gray-700 text-white hover:bg-gray-800'
            }`}
          >
            {refreshingClassifyStats ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Run Info */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-md">
        <h2 className="text-lg font-semibold mb-3">Run Info</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-600">
            {run.importBatches && run.importBatches.length > 1 ? 'Import Batches:' : 'Import Batch:'}
          </dt>
          <dd>
            {run.importBatches && run.importBatches.length > 1 ? (
              <ul className="space-y-1">
                {run.importBatches.map((batch) => (
                  <li key={batch.id} className="flex items-center gap-2">
                    <code className="bg-gray-200 px-1 rounded text-xs">{batch.id}</code>
                    <span className="text-gray-600 text-xs">
                      {batch.originalFilename} ({batch.source.toLowerCase()})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <code className="bg-gray-200 px-1 rounded text-xs">{run.importBatchId}</code>
            )}
          </dd>
          <dt className="text-gray-600">Model:</dt>
          <dd>{run.model}</dd>
          <dt className="text-gray-600">Sources:</dt>
          <dd>{run.sources.join(', ')}</dd>
          <dt className="text-gray-600">Date Range:</dt>
          <dd>
            {run.startDate} to {run.endDate}
          </dd>
        </dl>
      </div>

      {/* Job Table */}
      <div className="mt-6 p-4 bg-white border border-gray-200 rounded-md shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Jobs</h2>

        {resetError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {resetError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 pr-4 font-medium text-gray-600">Day Date</th>
                <th className="pb-2 pr-4 font-medium text-gray-600">Status</th>
                <th className="pb-2 pr-4 font-medium text-gray-600">Attempt</th>
                <th className="pb-2 pr-4 font-medium text-gray-600 text-right">Tokens In</th>
                <th className="pb-2 pr-4 font-medium text-gray-600 text-right">Tokens Out</th>
                <th className="pb-2 pr-4 font-medium text-gray-600 text-right">Cost (USD)</th>
                <th className="pb-2 pr-4 font-medium text-gray-600">Error</th>
                <th className="pb-2 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {run.jobs.map((job) => (
                <JobRow
                  key={job.dayDate}
                  job={job}
                  runId={run.id}
                  runStatus={run.status}
                  isResetting={resettingDay === job.dayDate}
                  onReset={() => handleResetJob(job.dayDate)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}

function FrozenConfigBlock({ config }: { config: RunConfig }) {
  return (
    <div className="space-y-4">
      {/* Prompt Version IDs */}
      <ConfigSection title="Prompt Version IDs">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-600">summarize:</dt>
          <dd>
            <code className="bg-white px-1 rounded text-xs">
              {config.promptVersionIds.summarize}
            </code>
          </dd>
        </dl>
      </ConfigSection>

      {/* Label Spec */}
      <ConfigSection title="Label Spec">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-600">model:</dt>
          <dd>{config.labelSpec.model}</dd>
          <dt className="text-gray-600">promptVersionId:</dt>
          <dd>
            <code className="bg-white px-1 rounded text-xs">
              {config.labelSpec.promptVersionId}
            </code>
          </dd>
        </dl>
      </ConfigSection>

      {/* Filter Profile Snapshot */}
      <ConfigSection title="Filter Profile Snapshot">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-600">name:</dt>
          <dd>{config.filterProfile.name}</dd>
          <dt className="text-gray-600">mode:</dt>
          <dd>{config.filterProfile.mode}</dd>
          <dt className="text-gray-600">categories:</dt>
          <dd>
            <div className="flex flex-wrap gap-1">
              {config.filterProfile.categories.map((cat) => (
                <span
                  key={cat}
                  className="px-1.5 py-0.5 bg-white rounded text-xs border border-blue-100"
                >
                  {cat}
                </span>
              ))}
            </div>
          </dd>
        </dl>
      </ConfigSection>

      {/* Timezone */}
      <ConfigSection title="Timezone">
        <span className="text-sm">{config.timezone}</span>
      </ConfigSection>

      {/* Max Input Tokens */}
      <ConfigSection title="Max Input Tokens">
        <span className="text-sm">{config.maxInputTokens.toLocaleString()}</span>
      </ConfigSection>
    </div>
  )
}

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/50 p-3 rounded">
      <h3 className="text-sm font-medium text-blue-700 mb-2">{title}</h3>
      {children}
    </div>
  )
}

/**
 * Grouped run controls component.
 * Per UX_SPEC §4.4: "Tick, reset, resume/cancel style controls are grouped and clearly state side effects."
 * CRITICAL invariant: No overlapping tick requests allowed.
 */
function RunControls({
  run,
  tickInFlight,
  lastTickResult,
  lastTickError,
  onTick,
  resumeInFlight,
  lastResumeResult,
  lastResumeError,
  onResume,
  cancelInFlight,
  lastCancelResult,
  lastCancelError,
  onCancel,
}: {
  run: RunDetail
  tickInFlight: boolean
  lastTickResult: TickResult | null
  lastTickError: TickError | null
  onTick: () => void
  resumeInFlight: boolean
  lastResumeResult: { jobsRequeued: number; status: string } | null
  lastResumeError: TickError | null
  onResume: () => void
  cancelInFlight: boolean
  lastCancelResult: { jobsCancelled: number; status: string } | null
  lastCancelError: TickError | null
  onCancel: () => void
}) {
  const isTerminal = run.status === 'cancelled' || run.status === 'completed'
  const canTick = !isTerminal && !tickInFlight
  const hasFailedJobs = run.progress.failed > 0
  const canResume = !isTerminal && hasFailedJobs && !resumeInFlight
  const canCancel = !isTerminal && !cancelInFlight

  return (
    <div className="mt-6 p-4 bg-white border border-gray-200 rounded-md shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Run Controls</h2>

      {isTerminal && (
        <div className="mb-3 text-sm text-gray-500">
          Run is {run.status} — controls are disabled.
        </div>
      )}

      <div className="flex items-start gap-3 flex-wrap">
        {/* Tick */}
        <div className="flex flex-col items-start gap-1">
          <button
            onClick={onTick}
            disabled={!canTick}
            className={`px-4 py-2 rounded font-medium ${
              canTick
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {tickInFlight ? 'Processing...' : 'Tick'}
          </button>
          <span className="text-xs text-gray-500">Process the next batch of queued jobs</span>
        </div>

        {/* Resume */}
        <div className="flex flex-col items-start gap-1">
          <button
            onClick={onResume}
            disabled={!canResume}
            className={`px-4 py-2 rounded font-medium ${
              canResume
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {resumeInFlight ? 'Resuming...' : 'Resume'}
          </button>
          <span className="text-xs text-gray-500">Requeue failed jobs for retry</span>
        </div>

        {/* Cancel */}
        <div className="flex flex-col items-start gap-1">
          <button
            onClick={onCancel}
            disabled={!canCancel}
            className={`px-4 py-2 rounded font-medium ${
              canCancel
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {cancelInFlight ? 'Cancelling...' : 'Cancel'}
          </button>
          <span className="text-xs text-gray-500">Cancel all queued jobs (irreversible)</span>
        </div>
      </div>

      {/* In-flight status messages */}
      {tickInFlight && (
        <div className="mt-3 text-sm text-blue-600">
          Tick in progress — waiting for response...
        </div>
      )}
      {resumeInFlight && (
        <div className="mt-3 text-sm text-blue-600">
          Resume in progress — requeuing failed jobs...
        </div>
      )}
      {cancelInFlight && (
        <div className="mt-3 text-sm text-red-600">
          Cancel in progress — stopping queued jobs...
        </div>
      )}

      {/* Last action results */}
      {(lastTickResult || lastTickError || lastResumeResult || lastResumeError || lastCancelResult || lastCancelError) && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Last Action Results</h3>

          {/* Tick result */}
          {lastTickError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
              <span className="font-medium text-red-700">Tick Error:</span>{' '}
              <code className="text-red-600">{lastTickError.code}</code>
              <span className="text-red-700"> — {lastTickError.message}</span>
            </div>
          )}

          {lastTickResult && !lastTickError && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-gray-600">Tick Processed:</dt>
                <dd className="font-medium">{lastTickResult.processed} job(s)</dd>
                <dt className="text-gray-600">Run Status:</dt>
                <dd>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(lastTickResult.runStatus)}`}
                  >
                    {lastTickResult.runStatus}
                  </span>
                </dd>
              </dl>

              {lastTickResult.jobs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <span className="text-xs text-gray-500">Processed jobs:</span>
                  <ul className="mt-1 space-y-1">
                    {lastTickResult.jobs.map((job) => (
                      <li key={job.dayDate} className="text-xs">
                        <code className="bg-gray-200 px-1 rounded">{job.dayDate}</code>
                        {' → '}
                        <span
                          className={`px-1.5 py-0.5 rounded ${getJobStatusColor(job.status)}`}
                        >
                          {job.status}
                        </span>
                        {job.error && (
                          <span className="text-red-600 ml-1">({job.error})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Resume result */}
          {lastResumeError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
              <span className="font-medium text-red-700">Resume Error:</span>{' '}
              <code className="text-red-600">{lastResumeError.code}</code>
              <span className="text-red-700"> — {lastResumeError.message}</span>
            </div>
          )}

          {lastResumeResult && !lastResumeError && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
              <span className="font-medium text-blue-700">Resume:</span>{' '}
              {lastResumeResult.jobsRequeued} job(s) requeued — run status:{' '}
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(lastResumeResult.status)}`}
              >
                {lastResumeResult.status}
              </span>
            </div>
          )}

          {/* Cancel result */}
          {lastCancelError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
              <span className="font-medium text-red-700">Cancel Error:</span>{' '}
              <code className="text-red-600">{lastCancelError.code}</code>
              <span className="text-red-700"> — {lastCancelError.message}</span>
            </div>
          )}

          {lastCancelResult && !lastCancelError && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
              <span className="font-medium text-yellow-700">Cancelled:</span>{' '}
              {lastCancelResult.jobsCancelled} job(s) cancelled — run status:{' '}
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(lastCancelResult.status)}`}
              >
                {lastCancelResult.status}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function JobRow({
  job,
  runId,
  runStatus,
  isResetting,
  onReset,
}: {
  job: JobDetail
  runId: string
  runStatus: string
  isResetting: boolean
  onReset: () => void
}) {
  // Parse error if present
  let errorDisplay: string | null = null
  if (job.error) {
    try {
      const parsed = JSON.parse(job.error)
      errorDisplay = parsed.message || job.error
    } catch {
      errorDisplay = job.error
    }
  }

  // Disable reset for cancelled runs (terminal status rule)
  const canReset = runStatus !== 'cancelled'

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="py-2 pr-4">
          <code className="text-xs bg-gray-100 px-1 rounded">{job.dayDate}</code>
        </td>
        <td className="py-2 pr-4">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getJobStatusColor(job.status)}`}>
            {job.status}
          </span>
        </td>
        <td className="py-2 pr-4 text-center">{job.attempt}</td>
        <td className="py-2 pr-4 text-right">{job.tokensIn.toLocaleString()}</td>
        <td className="py-2 pr-4 text-right">{job.tokensOut.toLocaleString()}</td>
        <td className="py-2 pr-4 text-right">${job.costUsd.toFixed(4)}</td>
        <td className="py-2 pr-4">
          {errorDisplay && (
            <span className="text-xs text-red-600 truncate block max-w-[150px]" title={errorDisplay}>
              {errorDisplay}
            </span>
          )}
        </td>
        <td className="py-2">
          <button
            onClick={onReset}
            disabled={isResetting || !canReset}
            className={`px-2 py-1 text-xs rounded ${
              isResetting || !canReset
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
            }`}
            title={!canReset ? 'Cannot reset jobs on cancelled runs' : 'Reset this job'}
          >
            {isResetting ? 'Resetting...' : 'Reset'}
          </button>
        </td>
      </tr>
      {/* Inspector row - spans all columns */}
      <tr className="bg-gray-50/50">
        <td colSpan={8} className="px-4 pb-3">
          <div className="flex gap-2">
            <InputViewer runId={runId} dayDate={job.dayDate} />
            <OutputViewer runId={runId} dayDate={job.dayDate} jobStatus={job.status} />
          </div>
        </td>
      </tr>
    </>
  )
}

