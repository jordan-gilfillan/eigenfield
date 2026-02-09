'use client'

import Link from 'next/link'
import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Types (mirrors API responses)
// ---------------------------------------------------------------------------

interface ImportBatchSummary {
  id: string
  createdAt: string
  source: string
  originalFilename: string
  stats: {
    message_count: number
    day_count: number
    coverage_start: string
    coverage_end: string
  }
}

interface DayInfo {
  dayDate: string
  atomCount: number
  sources: string[]
}

interface AtomView {
  atomStableId: string
  source: string
  timestampUtc: string
  role: string
  text: string
  category: string | null
  confidence: number | null
}

// ---------------------------------------------------------------------------
// Batch selector (shown when importBatchId is missing)
// ---------------------------------------------------------------------------

function BatchSelector({
  onSelect,
}: {
  onSelect: (batchId: string) => void
}) {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/distill/import-batches?limit=50')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || 'Failed to load batches')
        if (!cancelled) {
          setBatches(data.items)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load batches')
          setLoading(false)
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="text-gray-500 text-sm">Loading import batches...</div>
  if (error) return <div className="text-red-600 text-sm">{error}</div>
  if (batches.length === 0) {
    return (
      <div className="text-gray-500 text-sm">
        No import batches found.{' '}
        <Link href="/distill/import" className="text-blue-600 hover:underline">
          Import a file first.
        </Link>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Select an import batch to inspect</h2>
      <div className="space-y-2">
        {batches.map((batch) => (
          <button
            key={batch.id}
            onClick={() => onSelect(batch.id)}
            className="w-full text-left p-3 border border-gray-200 rounded-md hover:border-blue-400 hover:bg-blue-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{batch.originalFilename}</span>
              <span className="text-xs text-gray-400">{batch.source}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {batch.stats.day_count} days &middot; {batch.stats.message_count} messages
              &middot; {batch.stats.coverage_start} to {batch.stats.coverage_end}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Day list sidebar
// ---------------------------------------------------------------------------

function DayList({
  days,
  selectedDay,
  onSelectDay,
}: {
  days: DayInfo[]
  selectedDay: string | null
  onSelectDay: (dayDate: string) => void
}) {
  return (
    <div className="space-y-1">
      {days.map((day) => {
        const isSelected = day.dayDate === selectedDay
        return (
          <button
            key={day.dayDate}
            onClick={() => onSelectDay(day.dayDate)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              isSelected
                ? 'bg-blue-100 text-blue-800 font-medium'
                : 'hover:bg-gray-100 text-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>{day.dayDate}</span>
              <span className="text-xs text-gray-400">{day.atomCount}</span>
            </div>
            <div className="text-xs text-gray-400">
              {day.sources.join(', ')}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Atom card
// ---------------------------------------------------------------------------

function AtomCard({ atom }: { atom: AtomView }) {
  const time = atom.timestampUtc.slice(11, 19) // HH:mm:ss
  return (
    <div className="p-3 border border-gray-200 rounded-md">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs text-gray-400 font-mono">{time}</span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            atom.role === 'user'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {atom.role}
        </span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
          {atom.source}
        </span>
        {atom.category && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            {atom.category}
            {atom.confidence !== null && (
              <span className="ml-1 text-purple-400">({(atom.confidence * 100).toFixed(0)}%)</span>
            )}
          </span>
        )}
        <span className="text-xs text-gray-300 font-mono ml-auto">
          {atom.atomStableId.slice(0, 12)}...
        </span>
      </div>
      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
        {atom.text}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main inspector content
// ---------------------------------------------------------------------------

function InspectorContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const batchIdParam = searchParams.get('importBatchId')
  const dayDateParam = searchParams.get('dayDate')
  const sourceParam = searchParams.get('source')

  const [batchId, setBatchId] = useState<string | null>(batchIdParam)
  const [days, setDays] = useState<DayInfo[]>([])
  const [selectedDay, setSelectedDay] = useState<string | null>(dayDateParam)
  const [sourceFilter, setSourceFilter] = useState<string>(sourceParam || '')
  const [atoms, setAtoms] = useState<AtomView[]>([])
  const [batchInfo, setBatchInfo] = useState<ImportBatchSummary | null>(null)

  const [loadingDays, setLoadingDays] = useState(false)
  const [loadingAtoms, setLoadingAtoms] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Collect unique sources from days for the filter dropdown
  const availableSources = Array.from(
    new Set(days.flatMap((d) => d.sources))
  ).sort()

  // Load batch info + days when batchId changes
  useEffect(() => {
    if (!batchId) return
    let cancelled = false

    async function load() {
      setLoadingDays(true)
      setError(null)
      try {
        // Fetch batch info and days in parallel
        const [batchRes, daysRes] = await Promise.all([
          fetch(`/api/distill/import-batches/${batchId}`),
          fetch(`/api/distill/import-batches/${batchId}/days`),
        ])

        const batchData = await batchRes.json()
        const daysData = await daysRes.json()

        if (!batchRes.ok) throw new Error(batchData.error?.message || 'Failed to load batch')
        if (!daysRes.ok) throw new Error(daysData.error?.message || 'Failed to load days')

        if (!cancelled) {
          setBatchInfo(batchData.importBatch)
          setDays(daysData.days)
          setLoadingDays(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load')
          setLoadingDays(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [batchId])

  // Load atoms when selectedDay or sourceFilter changes
  useEffect(() => {
    if (!batchId || !selectedDay) return
    let cancelled = false

    async function load() {
      setLoadingAtoms(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (sourceFilter) {
          params.set('source', sourceFilter)
        }
        const url = `/api/distill/import-batches/${batchId}/days/${selectedDay}/atoms?${params}`
        const res = await fetch(url)
        const data = await res.json()

        if (!res.ok) throw new Error(data.error?.message || 'Failed to load atoms')

        if (!cancelled) {
          setAtoms(data.atoms)
          setLoadingAtoms(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load atoms')
          setLoadingAtoms(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [batchId, selectedDay, sourceFilter])

  // Handle batch selection (from selector)
  const handleBatchSelect = useCallback(
    (id: string) => {
      setBatchId(id)
      // Update URL with importBatchId, preserve dayDate/source if present
      const params = new URLSearchParams()
      params.set('importBatchId', id)
      if (dayDateParam) params.set('dayDate', dayDateParam)
      if (sourceParam) params.set('source', sourceParam)
      router.replace(`/distill/import/inspect?${params}`)
    },
    [router, dayDateParam, sourceParam]
  )

  // Handle day selection
  const handleDaySelect = useCallback(
    (dayDate: string) => {
      setSelectedDay(dayDate)
      // Update URL
      const params = new URLSearchParams()
      if (batchId) params.set('importBatchId', batchId)
      params.set('dayDate', dayDate)
      if (sourceFilter) params.set('source', sourceFilter)
      router.replace(`/distill/import/inspect?${params}`)
    },
    [router, batchId, sourceFilter]
  )

  // If no batchId, show the selector
  if (!batchId) {
    return (
      <main className="min-h-screen p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Import Inspector</h1>
        <BatchSelector onSelect={handleBatchSelect} />
      </main>
    )
  }

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Import Inspector</h1>
      {batchInfo && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-md text-sm text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-gray-800">{batchInfo.originalFilename}</span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700 capitalize">
            {batchInfo.source.toLowerCase()}
          </span>
          <span>{batchInfo.stats.coverage_start} to {batchInfo.stats.coverage_end}</span>
          {selectedDay && (
            <>
              <span className="text-gray-300">|</span>
              <span className="font-medium text-blue-700">{selectedDay}</span>
            </>
          )}
          {sourceFilter && (
            <>
              <span className="text-gray-300">|</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                {sourceFilter}
                <button
                  onClick={() => {
                    setSourceFilter('')
                    // Update URL to remove source param
                    const params = new URLSearchParams()
                    if (batchId) params.set('importBatchId', batchId)
                    if (selectedDay) params.set('dayDate', selectedDay)
                    router.replace(`/distill/import/inspect?${params}`)
                  }}
                  className="ml-0.5 hover:text-blue-900"
                  title="Clear source filter"
                >
                  &times;
                </button>
              </span>
            </>
          )}
          {selectedDay && !loadingAtoms && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-gray-500">
                {atoms.length} atom{atoms.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="flex gap-6">
        {/* Day list sidebar */}
        <div className="w-56 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Days</h2>
          {loadingDays ? (
            <div className="text-sm text-gray-400">Loading days...</div>
          ) : days.length === 0 ? (
            <div className="text-sm text-gray-400">
              No days found for this batch.
            </div>
          ) : (
            <DayList
              days={days}
              selectedDay={selectedDay}
              onSelectDay={handleDaySelect}
            />
          )}
        </div>

        {/* Atoms panel */}
        <div className="flex-1 min-w-0">
          {selectedDay ? (
            <>
              <div className="flex items-center gap-4 mb-4">
                <h2 className="text-lg font-semibold">{selectedDay}</h2>

                {/* Source filter dropdown */}
                {availableSources.length > 1 && (
                  <div className="flex items-center gap-1">
                    <select
                      value={sourceFilter}
                      onChange={(e) => {
                        const val = e.target.value
                        setSourceFilter(val)
                        const params = new URLSearchParams()
                        if (batchId) params.set('importBatchId', batchId)
                        if (selectedDay) params.set('dayDate', selectedDay)
                        if (val) params.set('source', val)
                        router.replace(`/distill/import/inspect?${params}`)
                      }}
                      className="text-sm border border-gray-300 rounded-md px-2 py-1"
                    >
                      <option value="">All sources</option>
                      {availableSources.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    {sourceFilter && (
                      <button
                        onClick={() => {
                          setSourceFilter('')
                          const params = new URLSearchParams()
                          if (batchId) params.set('importBatchId', batchId)
                          if (selectedDay) params.set('dayDate', selectedDay)
                          router.replace(`/distill/import/inspect?${params}`)
                        }}
                        className="text-sm text-gray-500 hover:text-gray-700 px-1"
                        title="Clear source filter"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {!loadingAtoms && (
                  <span className="text-sm text-gray-400">
                    {atoms.length} atom{atoms.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {loadingAtoms ? (
                <div className="text-sm text-gray-400">Loading atoms...</div>
              ) : atoms.length === 0 ? (
                <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-md">
                  {sourceFilter ? (
                    <div>
                      <p>No <span className="font-medium">{sourceFilter}</span> atoms on <span className="font-medium">{selectedDay}</span>.</p>
                      <button
                        onClick={() => {
                          setSourceFilter('')
                          const params = new URLSearchParams()
                          if (batchId) params.set('importBatchId', batchId)
                          if (selectedDay) params.set('dayDate', selectedDay)
                          router.replace(`/distill/import/inspect?${params}`)
                        }}
                        className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Clear filter
                      </button>
                    </div>
                  ) : (
                    <p>No atoms found for this day.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {atoms.map((atom) => (
                    <AtomCard key={atom.atomStableId} atom={atom} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-500 p-8 text-center bg-gray-50 rounded-md">
              <p className="mb-1 font-medium">No day selected</p>
              <p>&larr; Select a day from the sidebar to view atoms.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Page export with Suspense boundary (required for useSearchParams)
// ---------------------------------------------------------------------------

export default function ImportInspectPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <InspectorContent />
    </Suspense>
  )
}
