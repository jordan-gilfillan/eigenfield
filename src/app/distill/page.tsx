'use client'

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useCallback } from 'react'

interface ClassifyResult {
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

  // Run creation state
  const [filterProfiles, setFilterProfiles] = useState<FilterProfile[]>([])
  const [selectedFilterProfileId, setSelectedFilterProfileId] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedSources, setSelectedSources] = useState<string[]>(['chatgpt', 'claude', 'grok'])
  const [model, setModel] = useState('stub_summarizer_v1')
  const [creatingRun, setCreatingRun] = useState(false)
  const [createRunError, setCreateRunError] = useState<string | null>(null)

  // Fetch import batches on mount
  useEffect(() => {
    async function fetchBatches() {
      try {
        const res = await fetch('/api/distill/import-batches?limit=50')
        if (res.ok) {
          const data = await res.json()
          setImportBatches(data.items || [])

          // Auto-select latest batch if none specified in URL
          if (!importBatchIdFromUrl && data.items?.length > 0) {
            setSelectedBatchId(data.items[0].id)
          }
        }
      } catch {
        // Silently fail
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
        const stubData = stubRes.ok ? await stubRes.json() : {}
        const realData = realRes.ok ? await realRes.json() : {}
        setClassifyPromptVersions({
          stub: stubData.promptVersion ?? null,
          real: realData.promptVersion ?? null,
        })
      } catch {
        // Silently fail
      }
    }
    fetchPromptVersions()
  }, [])

  // Fetch filter profiles on mount
  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/distill/filter-profiles')
        if (res.ok) {
          const data = await res.json()
          setFilterProfiles(data.items || [])
          // Auto-select professional-only as default
          const defaultProfile = data.items?.find((p: FilterProfile) => p.name === 'professional-only')
          if (defaultProfile) {
            setSelectedFilterProfileId(defaultProfile.id)
          } else if (data.items?.length > 0) {
            setSelectedFilterProfileId(data.items[0].id)
          }
        }
      } catch {
        // Silently fail
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

  // Update URL when batch selection changes (for shareability)
  function handleBatchSelect(batchId: string) {
    setSelectedBatchId(batchId)
    setClassifyResult(null)
    setClassifyError(null)
    router.push(`/distill?importBatchId=${batchId}`)
  }

  // Derive the prompt version for the selected mode
  const activeClassifyPv = classifyPromptVersions[classifyMode]

  async function handleClassify() {
    if (!selectedBatchId || !activeClassifyPv) return

    setClassifying(true)
    setClassifyError(null)
    setClassifyResult(null)

    const classifyModel = classifyMode === 'stub' ? 'stub_v1' : 'gpt-4o'

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

      const data = await res.json()

      if (!res.ok) {
        const code = data.error?.code ? `[${data.error.code}] ` : ''
        setClassifyError(`${code}${data.error?.message || 'Classification failed'}`)
        return
      }

      setClassifyResult(data)
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : 'Classification failed')
    } finally {
      setClassifying(false)
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

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:underline">
          &larr; Home
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      {/* Import Batch Selector */}
      <div className="mb-6 p-4 bg-white border border-gray-200 rounded-md shadow-sm">
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
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
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
        </div>
      )}

      {/* Feature Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md">
          <h2 className="text-xl font-semibold mb-4">Import</h2>
          <p className="text-gray-600 mb-4">
            Upload ChatGPT, Claude, or Grok exports to create MessageAtoms.
          </p>
          <Link
            href="/distill/import"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Import Conversations
          </Link>
        </div>

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md">
          <h2 className="text-xl font-semibold mb-4">Classify</h2>
          <p className="text-gray-600 mb-4">
            Label messages with categories for filtering.
          </p>
          {selectedBatchId ? (
            <span className="inline-block px-4 py-2 bg-green-100 text-green-700 rounded">
              Ready — use section above
            </span>
          ) : (
            <span className="inline-block px-4 py-2 bg-yellow-100 text-yellow-700 rounded">
              Select a batch first
            </span>
          )}
        </div>

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md md:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Create Run</h2>
          <p className="text-gray-600 mb-4">
            Create a summarization run with frozen config from the selected batch.
          </p>

          {!selectedBatchId ? (
            <span className="inline-block px-4 py-2 bg-yellow-100 text-yellow-700 rounded">
              Select an import batch first
            </span>
          ) : !classifyResult ? (
            <span className="inline-block px-4 py-2 bg-yellow-100 text-yellow-700 rounded">
              Classify the batch first (section above)
            </span>
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

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md">
          <h2 className="text-xl font-semibold mb-4">Search</h2>
          <p className="text-gray-600 mb-4">
            Full-text search across atoms and outputs.
          </p>
          <Link
            href="/distill/search"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Search
          </Link>
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
