'use client'

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useCallback } from 'react'
import { getClassifyStatusColor, getStatusColor, formatProgressPercent } from './lib/ui-utils'
import type { LastClassifyStats } from './lib/types'
import { usePolling } from './hooks/usePolling'

interface ClassifyResult {
  classifyRunId: string
  importBatchId: string
  labelSpec: { model: string; promptVersionId: string }
  mode: 'stub' | 'real'
  totals: {
    messageAtoms: number
    labeled: number
    newlyLabeled: number
    skippedAlreadyLabeled: number
  }
}

const POLL_INTERVAL_MS = 1000

interface PromptVersion {
  id: string
  versionLabel: string
  prompt: { stage: string }
}

interface ImportBatch {
  id: string
  createdAt: string
  source: string
  originalFilename: string
  fileSizeBytes: number
  timezone: string
  stats: {
    message_count: number
    day_count: number
    coverage_start: string
    coverage_end: string
  }
}

interface FilterProfile {
  id: string
  name: string
  mode: string
  categories: string[]
}

interface LatestRun {
  id: string
  status: string
  model: string
  createdAt: string
  progress: {
    queued: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
  }
  totals: {
    jobs: number
  }
}

function DashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const importBatchIdFromUrl = searchParams.get('importBatchId')

  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(importBatchIdFromUrl)
  const [loadingBatches, setLoadingBatches] = useState(true)

  const [classifyPromptVersions, setClassifyPromptVersions] = useState<{
    stub: PromptVersion | null
    real: PromptVersion | null
  }>({ stub: null, real: null })
  const [classifyMode, setClassifyMode] = useState<'stub' | 'real'>('stub')
  const [classifying, setClassifying] = useState(false)
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)

  // Foreground polling state for classify progress
  const [classifyPollUrl, setClassifyPollUrl] = useState<string | null>(null)
  const [lastCheckpointAt, setLastCheckpointAt] = useState<Date | null>(null)

  // Foreground polling during classify (replaces inline setTimeout/AbortController logic)
  usePolling<LastClassifyStats>({
    url: classifyPollUrl,
    intervalMs: POLL_INTERVAL_MS,
    enabled: !!classifyPollUrl,
    onData: (data) => {
      if (data.hasStats && data.stats?.status === 'running') {
        setLastClassifyStats(data)
        setLastCheckpointAt(new Date())
      }
    },
  })

  // Last classify stats (persisted, from shared endpoint)
  const [lastClassifyStats, setLastClassifyStats] = useState<LastClassifyStats | null>(null)
  const [loadingLastClassifyStats, setLoadingLastClassifyStats] = useState(false)
  const [refreshingLastClassifyStats, setRefreshingLastClassifyStats] = useState(false)

  // Run creation state
  const [filterProfiles, setFilterProfiles] = useState<FilterProfile[]>([])
  const [selectedFilterProfileId, setSelectedFilterProfileId] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>(['chatgpt', 'claude', 'grok'])
  const [model, setModel] = useState('stub_summarizer_v1')
  const [creatingRun, setCreatingRun] = useState(false)
  const [createRunError, setCreateRunError] = useState<string | null>(null)

  // Latest run state
  const [latestRun, setLatestRun] = useState<LatestRun | null>(null)
  const [loadingLatestRun, setLoadingLatestRun] = useState(false)

  // Data load error (batches, prompt versions, filter profiles)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fetch import batches on mount
  useEffect(() => {
    async function fetchBatches() {
      try {
        const res = await fetch('/api/distill/import-batches?limit=50')
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setLoadError(data.error?.message || `Failed to load import batches (${res.status})`)
          return
        }
        const data = await res.json()
        setImportBatches(data.items || [])

        // Auto-select latest batch if none specified in URL
        if (!importBatchIdFromUrl && data.items?.length > 0) {
          setSelectedBatchId(data.items[0].id)
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load import batches')
      } finally {
        setLoadingBatches(false)
      }
    }
    fetchBatches()
  }, [importBatchIdFromUrl])

  // Fetch classify prompt versions (stub + real) on mount
  useEffect(() => {
    async function fetchPromptVersions() {
      try {
        const [stubRes, realRes] = await Promise.all([
          fetch('/api/distill/prompt-versions?stage=classify&versionLabel=classify_stub_v1'),
          fetch('/api/distill/prompt-versions?stage=classify&versionLabel=classify_real_v1'),
        ])
        if (!stubRes.ok && !realRes.ok) {
          setLoadError(`Failed to load prompt versions (${stubRes.status})`)
          return
        }
        const stubData = stubRes.ok ? await stubRes.json() : {}
        const realData = realRes.ok ? await realRes.json() : {}
        setClassifyPromptVersions({
          stub: stubData.promptVersion ?? null,
          real: realData.promptVersion ?? null,
        })
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load prompt versions')
      }
    }
    fetchPromptVersions()
  }, [])

  // Fetch filter profiles on mount
  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/distill/filter-profiles')
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setLoadError(data.error?.message || `Failed to load filter profiles (${res.status})`)
          return
        }
        const data = await res.json()
        setFilterProfiles(data.items || [])
        // Auto-select professional-only as default
        const defaultProfile = data.items?.find((p: FilterProfile) => p.name === 'professional-only')
        if (defaultProfile) {
          setSelectedFilterProfileId(defaultProfile.id)
        } else if (data.items?.length > 0) {
          setSelectedFilterProfileId(data.items[0].id)
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load filter profiles')
      }
    }
    fetchProfiles()
  }, [])

  // Compute selectedBatch before effects that depend on it
  const selectedBatch = importBatches.find((b) => b.id === selectedBatchId)

  // Update date range when batch changes
  useEffect(() => {
    if (selectedBatch) {
      setStartDate(selectedBatch.stats.coverage_start)
      setEndDate(selectedBatch.stats.coverage_end)
    }
  }, [selectedBatch])

  // Fetch latest run for the selected batch
  const fetchLatestRun = useCallback(async (batchId: string) => {
    setLoadingLatestRun(true)
    try {
      const listRes = await fetch(`/api/distill/runs?importBatchId=${encodeURIComponent(batchId)}&limit=1`)
      if (!listRes.ok) return
      const listData = await listRes.json()
      if (!listData.items?.length) {
        setLatestRun(null)
        return
      }
      const runId = listData.items[0].id
      const detailRes = await fetch(`/api/distill/runs/${runId}`)
      if (!detailRes.ok) return
      const detail = await detailRes.json()
      setLatestRun({
        id: detail.id,
        status: detail.status,
        model: detail.model,
        createdAt: detail.createdAt,
        progress: detail.progress,
        totals: { jobs: detail.totals.jobs },
      })
    } catch {
      // Latest run card is auxiliary — silent on fetch error
    } finally {
      setLoadingLatestRun(false)
    }
  }, [])

  useEffect(() => {
    if (selectedBatchId) {
      fetchLatestRun(selectedBatchId)
    } else {
      setLatestRun(null)
    }
  }, [selectedBatchId, fetchLatestRun])

  // Update URL when batch selection changes (for shareability)
  function handleBatchSelect(batchId: string) {
    setClassifyPollUrl(null)
    setSelectedBatchId(batchId)
    setClassifyResult(null)
    setClassifyError(null)
    setLastCheckpointAt(null)
    setLastClassifyStats(null)
    setLoadingLastClassifyStats(true)
    setLatestRun(null)
    router.push(`/distill?importBatchId=${batchId}`)
  }

  // Derive the prompt version for the selected mode
  const activeClassifyPv = classifyPromptVersions[classifyMode]

  // Last classify stats error (contextual, separate from initial load errors)
  const [lastClassifyStatsError, setLastClassifyStatsError] = useState<string | null>(null)

  // Fetch last classify stats for the selected batch + labelSpec
  const fetchLastClassifyStats = useCallback(async (batchId: string, labelModel: string, pvId: string) => {
    setLastClassifyStatsError(null)
    try {
      const res = await fetch(
        `/api/distill/import-batches/${batchId}/last-classify?model=${encodeURIComponent(labelModel)}&promptVersionId=${encodeURIComponent(pvId)}`
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLastClassifyStatsError(data.error?.message || `Failed to load classify stats (${res.status})`)
        return
      }
      const data: LastClassifyStats = await res.json()
      setLastClassifyStats(data)
    } catch (err) {
      setLastClassifyStatsError(err instanceof Error ? err.message : 'Failed to load classify stats')
    }
  }, [])

  // Fetch last classify stats when batch or mode changes (and pv is known).
  // Uses cleanup-based cancellation to prevent stale responses from overwriting
  // current state when the user switches batches quickly (AUD-042).
  useEffect(() => {
    if (!selectedBatchId || !activeClassifyPv) {
      setLastClassifyStats(null)
      setLoadingLastClassifyStats(false)
      return
    }

    let cancelled = false
    const labelModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'

    setLoadingLastClassifyStats(true)
    setLastClassifyStatsError(null)

    ;(async () => {
      try {
        const res = await fetch(
          `/api/distill/import-batches/${selectedBatchId}/last-classify?model=${encodeURIComponent(labelModel)}&promptVersionId=${encodeURIComponent(activeClassifyPv.id)}`
        )
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setLastClassifyStatsError(data.error?.message || `Failed to load classify stats (${res.status})`)
          return
        }
        const data: LastClassifyStats = await res.json()
        if (!cancelled) {
          setLastClassifyStats(data)
        }
      } catch (err) {
        if (!cancelled) {
          setLastClassifyStatsError(err instanceof Error ? err.message : 'Failed to load classify stats')
        }
      } finally {
        if (!cancelled) {
          setLoadingLastClassifyStats(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [selectedBatchId, classifyMode, activeClassifyPv])

  const handleRefreshLastClassifyStats = useCallback(async () => {
    if (!selectedBatchId || !activeClassifyPv) return
    setRefreshingLastClassifyStats(true)
    try {
      const labelModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'
      await fetchLastClassifyStats(selectedBatchId, labelModel, activeClassifyPv.id)
    } finally {
      setRefreshingLastClassifyStats(false)
    }
  }, [selectedBatchId, activeClassifyPv, classifyMode, fetchLastClassifyStats])

  async function handleClassify() {
    if (!selectedBatchId || !activeClassifyPv) return

    setClassifying(true)
    setClassifyError(null)
    setClassifyResult(null)

    const classifyModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'

    // Start foreground polling via last-classify to show progress while POST is in-flight
    const batchId = selectedBatchId
    const pvId = activeClassifyPv.id
    setClassifyPollUrl(
      `/api/distill/import-batches/${batchId}/last-classify?model=${encodeURIComponent(classifyModel)}&promptVersionId=${encodeURIComponent(pvId)}`
    )

    try {
      const res = await fetch('/api/distill/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId: selectedBatchId,
          model: classifyModel,
          promptVersionId: activeClassifyPv.id,
          mode: classifyMode,
        }),
      })

      // POST returned — stop the interim polling
      setClassifyPollUrl(null)

      const data = await res.json()

      if (!res.ok) {
        const code = data.error?.code ? `[${data.error.code}] ` : ''
        setClassifyError(`${code}${data.error?.message || 'Classification failed'}`)
        return
      }

      setClassifyResult(data)

      // Refresh last classify stats from shared endpoint
      const classifyRes = data as ClassifyResult
      fetchLastClassifyStats(
        classifyRes.importBatchId,
        classifyRes.labelSpec.model,
        classifyRes.labelSpec.promptVersionId
      )
    } catch (err) {
      setClassifyPollUrl(null)
      setClassifyError(err instanceof Error ? err.message : 'Classification failed')
    } finally {
      setClassifying(false)
      setLastCheckpointAt(null)
    }
  }

  const handleSourceToggle = useCallback((source: string) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    )
  }, [])

  const handleCreateRun = useCallback(async () => {
    // Run creation uses whichever classify prompt version was used for classification
    const classifyPvForRun = activeClassifyPv
    if (!selectedBatchId || !classifyPvForRun || !selectedFilterProfileId) return
    if (!startDate || !endDate) return
    if (selectedSources.length === 0) return

    setCreatingRun(true)
    setCreateRunError(null)

    const classifyModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'

    try {
      const res = await fetch('/api/distill/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId: selectedBatchId,
          startDate,
          endDate,
          sources: selectedSources,
          filterProfileId: selectedFilterProfileId,
          model,
          labelSpec: {
            model: classifyModel,
            promptVersionId: classifyPvForRun.id,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setCreateRunError(data.error?.message || 'Failed to create run')
        return
      }

      // Navigate to the new run's detail page
      router.push(`/distill/runs/${data.id}`)
    } catch (err) {
      setCreateRunError(err instanceof Error ? err.message : 'Failed to create run')
    } finally {
      setCreatingRun(false)
    }
  }, [selectedBatchId, activeClassifyPv, classifyMode, selectedFilterProfileId, startDate, endDate, selectedSources, model, router])

  const completedJobs = latestRun
    ? latestRun.progress.succeeded + latestRun.progress.failed + latestRun.progress.cancelled
    : 0

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      {loadError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 font-medium">Failed to load data</p>
          <p className="text-red-600 text-sm mt-1">{loadError}</p>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left column: primary flow */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Import Batch Selector */}
          <div className="p-4 bg-white border border-gray-200 rounded-md shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Select Import Batch</h2>

            {loadingBatches ? (
              <p className="text-gray-500">Loading import batches...</p>
            ) : importBatches.length === 0 ? (
              <div className="text-gray-600">
                <p className="mb-2">No import batches found.</p>
                <Link
                  href="/distill/import"
                  className="text-blue-600 hover:underline"
                >
                  Import your first conversation export &rarr;
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <select
                  value={selectedBatchId || ''}
                  onChange={(e) => handleBatchSelect(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-md bg-white"
                >
                  {importBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.originalFilename} — {batch.stats.message_count} messages,{' '}
                      {batch.stats.day_count} days ({batch.source.toLowerCase()})
                    </option>
                  ))}
                </select>

                {selectedBatch && (
                  <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="font-medium">Source:</span>{' '}
                        {selectedBatch.source.toLowerCase()}
                      </div>
                      <div>
                        <span className="font-medium">Timezone:</span>{' '}
                        {selectedBatch.timezone}
                      </div>
                      <div>
                        <span className="font-medium">Coverage:</span>{' '}
                        {selectedBatch.stats.coverage_start} to {selectedBatch.stats.coverage_end}
                      </div>
                      <div>
                        <span className="font-medium">Imported:</span>{' '}
                        {new Date(selectedBatch.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Classification Section */}
          {selectedBatchId && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h2 className="text-lg font-semibold mb-3 text-blue-800">Classification</h2>

              {/* Mode selector */}
              <div className="mb-3">
                <label className="block text-sm font-medium text-blue-800 mb-1">Mode</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="classifyMode"
                      value="stub"
                      checked={classifyMode === 'stub'}
                      onChange={() => setClassifyMode('stub')}
                      disabled={classifying}
                    />
                    Stub (deterministic)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="classifyMode"
                      value="real"
                      checked={classifyMode === 'real'}
                      onChange={() => setClassifyMode('real')}
                      disabled={classifying}
                    />
                    Real (LLM-backed)
                  </label>
                </div>
                {classifyMode === 'real' && (
                  <p className="text-xs text-amber-700 mt-1">
                    Requires LLM_MODE=real and provider API key. Spend caps apply.
                  </p>
                )}
              </div>

              {classifyResult && (
                <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-green-700 font-medium">
                    Classification complete ({classifyResult.mode} mode)
                  </p>
                  <ul className="text-green-600 text-sm mt-1 space-y-1">
                    <li>Total atoms: {classifyResult.totals.messageAtoms}</li>
                    <li>Newly labeled: {classifyResult.totals.newlyLabeled}</li>
                    <li>Already labeled: {classifyResult.totals.skippedAlreadyLabeled}</li>
                    <li>
                      Label spec: {classifyResult.labelSpec.model} /{' '}
                      <code className="text-xs">{classifyResult.labelSpec.promptVersionId.slice(0, 8)}...</code>
                    </li>
                  </ul>
                </div>
              )}

              {classifyError && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-red-700">{classifyError}</p>
                </div>
              )}

              <div className="flex gap-2 items-center">
                <button
                  onClick={handleClassify}
                  disabled={classifying || !activeClassifyPv}
                  className={`px-4 py-2 rounded text-white ${
                    classifying || !activeClassifyPv
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {classifying
                    ? 'Classifying...'
                    : `Classify (${classifyMode})`}
                </button>
                {!activeClassifyPv && (
                  <span className="text-sm text-gray-500">
                    {classifyMode === 'real' && !classifyPromptVersions.real
                      ? 'No real classify prompt version found. Run: npx prisma db seed'
                      : 'Loading prompt version...'}
                  </span>
                )}
                <span className="text-sm text-blue-600">
                  {classifyMode === 'stub'
                    ? 'Assigns categories using deterministic stub algorithm'
                    : 'Assigns categories using LLM provider (costs apply)'}
                </span>
              </div>

              {/* Live Classify Progress (foreground polling while classify is running) */}
              {classifying && lastClassifyStats?.hasStats && lastClassifyStats.stats?.status === 'running' && (
                <div className="mt-3 p-3 bg-indigo-50 border border-indigo-200 rounded text-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <p className="font-medium text-indigo-800">Classify Progress</p>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-200 text-blue-700">
                      running
                    </span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-indigo-700 text-xs mb-1">
                      <span>
                        Processed {lastClassifyStats.stats.processedAtoms} / {lastClassifyStats.stats.totalAtoms}
                      </span>
                      <span>
                        {formatProgressPercent(lastClassifyStats.stats.processedAtoms, lastClassifyStats.stats.totalAtoms)}%
                      </span>
                    </div>
                    <div className="w-full bg-indigo-100 rounded-full h-2">
                      <div
                        className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${formatProgressPercent(lastClassifyStats.stats.processedAtoms, lastClassifyStats.stats.totalAtoms)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-indigo-700">
                    <div>Newly labeled: {lastClassifyStats.stats.newlyLabeled}</div>
                    <div>Skipped (already): {lastClassifyStats.stats.skippedAlreadyLabeled}</div>
                    {lastClassifyStats.stats.skippedBadOutput > 0 && (
                      <div>Skipped (bad output): {lastClassifyStats.stats.skippedBadOutput}</div>
                    )}
                    {lastClassifyStats.stats.aliasedCount > 0 && (
                      <div>Aliased: {lastClassifyStats.stats.aliasedCount}</div>
                    )}
                    {lastClassifyStats.stats.tokensIn !== null && (
                      <div>Tokens: {lastClassifyStats.stats.tokensIn.toLocaleString()} in / {(lastClassifyStats.stats.tokensOut ?? 0).toLocaleString()} out</div>
                    )}
                    {lastClassifyStats.stats.costUsd !== null && (
                      <div>Cost: ${lastClassifyStats.stats.costUsd.toFixed(4)}</div>
                    )}
                  </div>
                  {lastCheckpointAt && (
                    <div className="mt-2 text-xs text-indigo-500">
                      Last checkpoint: {lastCheckpointAt.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}

              {/* Last Classify Stats (persisted) */}
              {lastClassifyStats && lastClassifyStats.hasStats && lastClassifyStats.stats && (
                <div className="mt-3 p-3 bg-blue-100 border border-blue-300 rounded text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="font-medium text-blue-800">Last Classify Stats</p>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getClassifyStatusColor(lastClassifyStats.stats.status)}`}
                    >
                      {lastClassifyStats.stats.status}
                    </span>
                    <button
                      onClick={handleRefreshLastClassifyStats}
                      disabled={refreshingLastClassifyStats}
                      className={`ml-auto px-2 py-1 rounded text-xs font-medium ${
                        refreshingLastClassifyStats
                          ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-700 text-white hover:bg-blue-800'
                      }`}
                    >
                      {refreshingLastClassifyStats ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-blue-700">
                    <div>Total atoms: {lastClassifyStats.stats.totalAtoms}</div>
                    <div>Processed atoms: {lastClassifyStats.stats.processedAtoms}</div>
                    <div>Labeled total: {lastClassifyStats.stats.labeledTotal}</div>
                    <div>Newly labeled: {lastClassifyStats.stats.newlyLabeled}</div>
                    <div>Skipped (already): {lastClassifyStats.stats.skippedAlreadyLabeled}</div>
                    <div>Skipped (bad output): {lastClassifyStats.stats.skippedBadOutput}</div>
                    <div>Aliased category count: {lastClassifyStats.stats.aliasedCount}</div>
                    {lastClassifyStats.stats.status === 'running' && (
                      <div className="col-span-2 font-medium">
                        Progress: {lastClassifyStats.stats.processedAtoms}/{lastClassifyStats.stats.totalAtoms}{' '}
                        ({formatProgressPercent(lastClassifyStats.stats.processedAtoms, lastClassifyStats.stats.totalAtoms)}%)
                      </div>
                    )}
                    <div>Mode: {lastClassifyStats.stats.mode}</div>
                    <div>
                      Run at:{' '}
                      {new Date(lastClassifyStats.stats.finishedAt ?? lastClassifyStats.stats.createdAt).toLocaleString()}
                    </div>
                    {lastClassifyStats.stats.tokensIn !== null && (
                      <div>Tokens in: {lastClassifyStats.stats.tokensIn.toLocaleString()}</div>
                    )}
                    {lastClassifyStats.stats.tokensOut !== null && (
                      <div>Tokens out: {lastClassifyStats.stats.tokensOut.toLocaleString()}</div>
                    )}
                    {lastClassifyStats.stats.costUsd !== null && (
                      <div>Cost: ${lastClassifyStats.stats.costUsd.toFixed(4)}</div>
                    )}
                    {lastClassifyStats.stats.status === 'failed' && lastClassifyStats.stats.errorJson && (
                      <div className="col-span-2 text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-1">
                        <span className="font-medium">Error [{lastClassifyStats.stats.errorJson.code}]</span>{' '}
                        {lastClassifyStats.stats.errorJson.message}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {lastClassifyStatsError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-red-700 text-sm">{lastClassifyStatsError}</p>
                </div>
              )}
              {lastClassifyStats && !lastClassifyStats.hasStats && (
                <div className="mt-3 flex items-center gap-3">
                  <p className="text-sm text-gray-500">No classify stats yet for this batch + label spec.</p>
                  <button
                    onClick={handleRefreshLastClassifyStats}
                    disabled={refreshingLastClassifyStats}
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      refreshingLastClassifyStats
                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                        : 'bg-gray-700 text-white hover:bg-gray-800'
                    }`}
                  >
                    {refreshingLastClassifyStats ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Create Run Section */}
          <div className="p-4 bg-white border border-gray-200 rounded-md shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Create Run</h2>
            <p className="text-gray-600 text-sm mb-3">
              Create a summarization run with frozen config from the selected batch.
            </p>

            {!selectedBatchId ? (
              <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-3">
                Select an import batch first.
              </p>
            ) : loadingLastClassifyStats ? (
              <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded p-3">
                Loading classify status...
              </p>
            ) : !lastClassifyStats || !lastClassifyStats.hasStats ? (
              <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-3">
                Classify the batch first using the classification section above.
              </p>
            ) : lastClassifyStats.stats?.status === 'running' ? (
              <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded p-3">
                Classification in progress &mdash; wait for it to finish before creating a run.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Date Range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>

                {/* Sources */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sources
                  </label>
                  <div className="flex gap-4">
                    {['chatgpt', 'claude', 'grok'].map((source) => (
                      <label key={source} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedSources.includes(source)}
                          onChange={() => handleSourceToggle(source)}
                          className="rounded"
                        />
                        <span className="capitalize">{source}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Filter Profile */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Filter Profile
                  </label>
                  <select
                    value={selectedFilterProfileId}
                    onChange={(e) => setSelectedFilterProfileId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white"
                  >
                    {filterProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name} ({profile.mode}: {profile.categories.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="stub_summarizer_v1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                {/* Error */}
                {createRunError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded">
                    <p className="text-red-700">{createRunError}</p>
                  </div>
                )}

                {/* Create Button */}
                <button
                  onClick={handleCreateRun}
                  disabled={
                    creatingRun ||
                    !selectedBatchId ||
                    !startDate ||
                    !endDate ||
                    selectedSources.length === 0 ||
                    !selectedFilterProfileId ||
                    !model
                  }
                  className={`px-4 py-2 rounded text-white ${
                    creatingRun ||
                    !selectedBatchId ||
                    !startDate ||
                    !endDate ||
                    selectedSources.length === 0 ||
                    !selectedFilterProfileId ||
                    !model
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {creatingRun ? 'Creating...' : 'Create Run'}
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Right column: status + context */}
        <div className="w-full md:w-80 flex-shrink-0 space-y-6">

          {/* Latest Run Card */}
          <div className="p-4 bg-white border border-gray-200 rounded-md shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Latest Run</h2>

            {!selectedBatchId ? (
              <p className="text-sm text-gray-500">
                Select an import batch to see its latest run.
              </p>
            ) : loadingLatestRun ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : !latestRun ? (
              <div>
                <p className="text-sm text-gray-500 mb-2">No runs yet for this batch.</p>
                <p className="text-sm text-gray-400">
                  Create a run from the form on the left after classifying your import batch.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(latestRun.status)}`}
                  >
                    {latestRun.status}
                  </span>
                  <span className="text-xs text-gray-500">{latestRun.model}</span>
                </div>

                {/* Progress counters */}
                <div className="text-sm space-y-1">
                  <div className="flex justify-between text-gray-600">
                    <span>Total jobs</span>
                    <span className="font-medium">{latestRun.totals.jobs}</span>
                  </div>
                  {latestRun.totals.jobs > 0 && (
                    <>
                      <div className="flex justify-between text-gray-600">
                        <span>Completed</span>
                        <span className="font-medium">
                          {completedJobs} / {latestRun.totals.jobs}{' '}
                          ({formatProgressPercent(completedJobs, latestRun.totals.jobs)}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                          style={{
                            width: `${formatProgressPercent(completedJobs, latestRun.totals.jobs)}%`,
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-1">
                        {latestRun.progress.succeeded > 0 && (
                          <div className="text-green-600">Succeeded: {latestRun.progress.succeeded}</div>
                        )}
                        {latestRun.progress.failed > 0 && (
                          <div className="text-red-600">Failed: {latestRun.progress.failed}</div>
                        )}
                        {latestRun.progress.running > 0 && (
                          <div className="text-blue-600">Running: {latestRun.progress.running}</div>
                        )}
                        {latestRun.progress.queued > 0 && (
                          <div className="text-gray-500">Queued: {latestRun.progress.queued}</div>
                        )}
                        {latestRun.progress.cancelled > 0 && (
                          <div className="text-yellow-600">Cancelled: {latestRun.progress.cancelled}</div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="text-xs text-gray-400">
                  Created {new Date(latestRun.createdAt).toLocaleString()}
                </div>

                <Link
                  href={`/distill/runs/${latestRun.id}`}
                  className="inline-block px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                >
                  View Run &rarr;
                </Link>
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <h2 className="text-lg font-semibold mb-3">Quick Links</h2>
            <div className="space-y-2">
              <Link
                href="/distill/import"
                className="block px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 text-sm"
              >
                <span className="font-medium text-blue-600">Import Conversations</span>
                <span className="block text-xs text-gray-500 mt-0.5">Upload ChatGPT, Claude, or Grok exports</span>
              </Link>
              <Link
                href="/distill/search"
                className="block px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 text-sm"
              >
                <span className="font-medium text-blue-600">Search</span>
                <span className="block text-xs text-gray-500 mt-0.5">Full-text search across atoms and outputs</span>
              </Link>
              <Link
                href="/distill/import/inspect"
                className="block px-3 py-2 bg-white border border-gray-200 rounded hover:bg-gray-50 text-sm"
              >
                <span className="font-medium text-blue-600">Import Inspector</span>
                <span className="block text-xs text-gray-500 mt-0.5">Browse imported atoms by day and source</span>
              </Link>
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <DashboardContent />
    </Suspense>
  )
}
