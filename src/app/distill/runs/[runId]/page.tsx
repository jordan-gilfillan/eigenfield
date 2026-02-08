'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { OutputViewer } from './components/OutputViewer'
import { InputViewer } from './components/InputViewer'

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

interface RunDetail {
  id: string
  status: string
  importBatchId: string
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

interface LastClassifyStats {
  hasStats: boolean
  stats?: {
    status: 'running' | 'succeeded' | 'failed'
    totalAtoms: number
    processedAtoms: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
    skippedBadOutput: number
    aliasedCount: number
    labeledTotal: number
    tokensIn: number | null
    tokensOut: number | null
    costUsd: number | null
    mode: string
    errorJson: {
      code: string
      message: string
      details?: Record<string, unknown>
    } | null
    lastAtomStableIdProcessed: string | null
    startedAt: string
    finishedAt: string | null
    createdAt: string
  }
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

  // Last classify stats (same shared endpoint as dashboard)
  const [lastClassifyStats, setLastClassifyStats] = useState<LastClassifyStats | null>(null)
  const [refreshingClassifyStats, setRefreshingClassifyStats] = useState(false)

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

  const fetchLastClassifyStats = useCallback(async () => {
    if (!run) return
    const labelSpec = run.config.labelSpec
    if (!labelSpec?.model || !labelSpec?.promptVersionId) return

    try {
      const res = await fetch(
        `/api/distill/import-batches/${run.importBatchId}/last-classify?model=${encodeURIComponent(labelSpec.model)}&promptVersionId=${encodeURIComponent(labelSpec.promptVersionId)}`
      )
      if (res.ok) {
        const data: LastClassifyStats = await res.json()
        setLastClassifyStats(data)
      }
    } catch {
      // Silently fail
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

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Run Detail</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            ID: <code className="bg-gray-100 px-1 rounded">{run.id}</code>
          </span>
          <span>
            Status:{' '}
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(run.status)}`}
            >
              {run.status}
            </span>
          </span>
          <span>Created: {new Date(run.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {/* Frozen Config Block */}
      <FrozenConfigBlock config={run.config} />

      {/* Progress Summary */}
      <div className="mt-6 p-4 bg-white border border-gray-200 rounded-md shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Progress</h2>
        <div className="grid grid-cols-5 gap-4 text-center">
          <ProgressCard label="Queued" count={run.progress.queued} color="bg-gray-100" />
          <ProgressCard label="Running" count={run.progress.running} color="bg-blue-100" />
          <ProgressCard label="Succeeded" count={run.progress.succeeded} color="bg-green-100" />
          <ProgressCard label="Failed" count={run.progress.failed} color="bg-red-100" />
          <ProgressCard label="Cancelled" count={run.progress.cancelled} color="bg-yellow-100" />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-4 gap-4 text-sm text-gray-600">
          <div>
            <span className="font-medium">Total Jobs:</span> {run.totals.jobs}
          </div>
          <div>
            <span className="font-medium">Tokens In:</span> {run.totals.tokensIn.toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Tokens Out:</span> {run.totals.tokensOut.toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Cost:</span> ${run.totals.costUsd.toFixed(4)}
          </div>
        </div>
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

      {/* Manual Tick Control */}
      <TickControl
        runStatus={run.status}
        tickInFlight={tickInFlight}
        lastTickResult={lastTickResult}
        lastTickError={lastTickError}
        onTick={handleTick}
      />

      {/* Run Info */}
      <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-md">
        <h2 className="text-lg font-semibold mb-3">Run Info</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-600">Import Batch:</dt>
          <dd>
            <code className="bg-gray-200 px-1 rounded text-xs">{run.importBatchId}</code>
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

function getClassifyStatusColor(status: 'running' | 'succeeded' | 'failed'): string {
  switch (status) {
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'succeeded':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}

function formatProgressPercent(processedAtoms: number, totalAtoms: number): number {
  if (totalAtoms <= 0) return 100
  return Math.min(100, Math.round((processedAtoms / totalAtoms) * 100))
}

function FrozenConfigBlock({ config }: { config: RunConfig }) {
  return (
    <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
      <h2 className="text-lg font-semibold mb-3 text-blue-800">Frozen Config</h2>
      <p className="text-xs text-blue-600 mb-4">
        These values are frozen at run creation and will not change.
      </p>

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

function ProgressCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <div className={`p-3 rounded ${color}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs text-gray-600">{label}</div>
    </div>
  )
}

/**
 * Manual tick control component.
 * Per spec 7.5.1: Manual Tick control (single request; show last tick result)
 * CRITICAL invariant: No overlapping tick requests allowed.
 */
function TickControl({
  runStatus,
  tickInFlight,
  lastTickResult,
  lastTickError,
  onTick,
}: {
  runStatus: string
  tickInFlight: boolean
  lastTickResult: TickResult | null
  lastTickError: TickError | null
  onTick: () => void
}) {
  // Disable tick for terminal run states
  const isTerminal = runStatus === 'cancelled' || runStatus === 'completed'
  const canTick = !isTerminal && !tickInFlight

  return (
    <div className="mt-6 p-4 bg-white border border-gray-200 rounded-md shadow-sm">
      <h2 className="text-lg font-semibold mb-3">Manual Tick Control</h2>

      <div className="flex items-center gap-4">
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

        {isTerminal && (
          <span className="text-sm text-gray-500">
            Run is {runStatus} — no more ticks allowed
          </span>
        )}

        {tickInFlight && (
          <span className="text-sm text-blue-600">
            Tick in progress — waiting for response...
          </span>
        )}
      </div>

      {/* Last tick result display */}
      {(lastTickResult || lastTickError) && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Last Tick Result</h3>

          {lastTickError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
              <span className="font-medium text-red-700">Error:</span>{' '}
              <code className="text-red-600">{lastTickError.code}</code>
              <span className="text-red-700"> — {lastTickError.message}</span>
            </div>
          )}

          {lastTickResult && !lastTickError && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-gray-600">Processed:</dt>
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

              {/* Show processed jobs details if any */}
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

function getJobStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-gray-200 text-gray-700'
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'succeeded':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    case 'cancelled':
      return 'bg-yellow-200 text-yellow-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'bg-gray-200 text-gray-700'
    case 'running':
      return 'bg-blue-200 text-blue-700'
    case 'completed':
      return 'bg-green-200 text-green-700'
    case 'failed':
      return 'bg-red-200 text-red-700'
    case 'cancelled':
      return 'bg-yellow-200 text-yellow-700'
    default:
      return 'bg-gray-200 text-gray-700'
  }
}
