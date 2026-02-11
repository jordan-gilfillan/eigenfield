'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { usePolling } from '../hooks/usePolling'
import RunSelector from './components/RunSelector'
import DaySidebar from './components/DaySidebar'
import JournalEntry from './components/JournalEntry'
import StatusBar from './components/StatusBar'
import { getAnomalousDays } from './lib/anomaly'

interface Job {
  dayDate: string
  status: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  error: string | null
}

interface RunDetail {
  id: string
  status: string
  model: string
  startDate: string
  endDate: string
  jobs: Job[]
  progress: {
    queued: number
    running: number
    succeeded: number
    failed: number
    cancelled: number
  }
  totals: {
    jobs: number
    tokensIn: number
    tokensOut: number
    costUsd: number
  }
}

const DAY_STATUS_PRIORITY: Record<string, number> = {
  succeeded: 0,
  failed: 1,
  running: 2,
  queued: 3,
  cancelled: 4,
}

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed'])
const POLL_INTERVAL_MS = 3000

function pickDefaultDay(jobs: Job[]): string | null {
  if (jobs.length === 0) return null

  const sorted = [...jobs].sort((a, b) => {
    const pa = DAY_STATUS_PRIORITY[a.status] ?? 5
    const pb = DAY_STATUS_PRIORITY[b.status] ?? 5
    if (pa !== pb) return pa - pb
    return b.dayDate.localeCompare(a.dayDate)
  })

  return sorted[0].dayDate
}

export default function StudioPage() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const runId = searchParams.get('runId')
  const day = searchParams.get('day')

  const [run, setRun] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : true

  // Single source of truth for refreshing run data
  const refreshRun = useCallback(async () => {
    if (!runId) return
    const res = await fetch(`/api/distill/runs/${runId}`)
    if (res.ok) {
      const data = await res.json()
      setRun(data)
    }
  }, [runId])

  // Poll run detail when not terminal
  usePolling<RunDetail>({
    url: runId ? `/api/distill/runs/${runId}` : null,
    intervalMs: POLL_INTERVAL_MS,
    enabled: !!run && !isTerminal,
    onData: (data) => setRun(data),
    onTerminal: (data) => TERMINAL_STATUSES.has(data.status),
  })

  // If no runId, fetch the latest run and redirect
  useEffect(() => {
    if (runId) return

    let cancelled = false
    async function loadLatest() {
      const res = await fetch('/api/distill/runs?limit=1')
      if (cancelled) return
      if (!res.ok) {
        setError('Failed to load runs.')
        setLoading(false)
        return
      }
      const data = await res.json()
      if (cancelled) return
      const items = data.items ?? []
      if (items.length === 0) {
        setLoading(false)
        return
      }
      router.replace(`/distill/studio?runId=${items[0].id}`)
    }
    loadLatest()
    return () => { cancelled = true }
  }, [runId, router])

  // Fetch run detail when runId is set
  useEffect(() => {
    if (!runId) return

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadRun() {
      const res = await fetch(`/api/distill/runs/${runId}`)
      if (cancelled) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error?.message || `Failed to load run (${res.status})`)
        setLoading(false)
        return
      }
      const data = await res.json()
      if (cancelled) return
      setRun(data)
      setLoading(false)
    }
    loadRun()
    return () => { cancelled = true }
  }, [runId])

  // Auto-select default day when run loads and no valid day is selected
  useEffect(() => {
    if (!run || !runId) return

    const validDays = new Set(run.jobs.map((j) => j.dayDate))
    if (day && validDays.has(day)) return

    const defaultDay = pickDefaultDay(run.jobs)
    if (defaultDay) {
      router.replace(`/distill/studio?runId=${runId}&day=${defaultDay}`)
    }
  }, [run, runId, day, router])

  const handleRunSelect = useCallback(
    (newRunId: string) => {
      router.replace(`/distill/studio?runId=${newRunId}`)
    },
    [router],
  )

  const handleDaySelect = useCallback(
    (dayDate: string) => {
      router.replace(`/distill/studio?runId=${runId}&day=${dayDate}`)
    },
    [runId, router],
  )

  // Cost anomaly detection
  const anomalousDays = useMemo(
    () => (run ? getAnomalousDays(run.jobs) : new Set<string>()),
    [run],
  )

  // Empty state: no runs at all
  if (!loading && !runId && !run) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-12">
        <p className="text-gray-500">
          No runs yet. Create one from the{' '}
          <a href="/distill" className="text-blue-600 hover:underline">
            Dashboard
          </a>
          .
        </p>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-12">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-12">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (!run) return null

  const selectedJob = run.jobs.find((j) => j.dayDate === day) ?? null

  return (
    <div className="max-w-6xl mx-auto px-8 py-6">
      <div className="mb-4">
        <RunSelector selectedRunId={run.id} onSelect={handleRunSelect} />
      </div>

      <div className="border border-gray-200 rounded-lg bg-white min-h-[60vh] flex flex-col">
        <div className="grid grid-cols-[220px_1fr] gap-0 flex-1 min-h-0">
          {/* Day sidebar */}
          <div className="border-r border-gray-200 overflow-y-auto">
            <DaySidebar
              jobs={run.jobs}
              selectedDay={day}
              onDaySelect={handleDaySelect}
              anomalousDays={anomalousDays}
            />
          </div>

          {/* Journal entry */}
          <div className="overflow-y-auto">
            {selectedJob ? (
              <JournalEntry
                runId={run.id}
                dayDate={selectedJob.dayDate}
                jobStatus={selectedJob.status}
                jobError={selectedJob.error}
                jobTokensIn={selectedJob.tokensIn}
                jobTokensOut={selectedJob.tokensOut}
                jobCostUsd={selectedJob.costUsd}
              />
            ) : (
              <div className="px-8 py-6">
                <p className="text-sm text-gray-400">Select a day from the sidebar.</p>
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <StatusBar
          runId={run.id}
          runStatus={run.status}
          progress={run.progress}
          totalJobs={run.totals.jobs}
          totalCostUsd={run.totals.costUsd}
          onRefresh={refreshRun}
        />
      </div>
    </div>
  )
}
