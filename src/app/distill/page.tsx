'use client'

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect } from 'react'

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

function DashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const importBatchIdFromUrl = searchParams.get('importBatchId')

  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(importBatchIdFromUrl)
  const [loadingBatches, setLoadingBatches] = useState(true)

  const [classifyPromptVersion, setClassifyPromptVersion] = useState<PromptVersion | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)

  // Fetch import batches on mount
  useEffect(() => {
    async function fetchBatches() {
      try {
        const res = await fetch('/api/distill/import-batches?limit=50')
        if (res.ok) {
          const data = await res.json()
          setImportBatches(data.importBatches || [])

          // Auto-select latest batch if none specified in URL
          if (!importBatchIdFromUrl && data.importBatches?.length > 0) {
            setSelectedBatchId(data.importBatches[0].id)
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

  // Fetch active classify prompt version on mount
  useEffect(() => {
    async function fetchPromptVersion() {
      try {
        const res = await fetch('/api/distill/prompt-versions?stage=classify&active=true')
        if (res.ok) {
          const data = await res.json()
          if (data.promptVersion) {
            setClassifyPromptVersion(data.promptVersion)
          }
        }
      } catch {
        // Silently fail
      }
    }
    fetchPromptVersion()
  }, [])

  // Update URL when batch selection changes (for shareability)
  function handleBatchSelect(batchId: string) {
    setSelectedBatchId(batchId)
    setClassifyResult(null)
    setClassifyError(null)
    router.push(`/distill?importBatchId=${batchId}`)
  }

  async function handleClassify() {
    if (!selectedBatchId || !classifyPromptVersion) return

    setClassifying(true)
    setClassifyError(null)
    setClassifyResult(null)

    try {
      const res = await fetch('/api/distill/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId: selectedBatchId,
          model: 'stub_v1',
          promptVersionId: classifyPromptVersion.id,
          mode: 'stub',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setClassifyError(data.error?.message || 'Classification failed')
        return
      }

      setClassifyResult(data)
    } catch (err) {
      setClassifyError(err instanceof Error ? err.message : 'Classification failed')
    } finally {
      setClassifying(false)
    }
  }

  const selectedBatch = importBatches.find((b) => b.id === selectedBatchId)

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

          {classifyResult && (
            <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-green-700 font-medium">Classification complete!</p>
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
              disabled={classifying || !classifyPromptVersion}
              className={`px-4 py-2 rounded text-white ${
                classifying || !classifyPromptVersion
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {classifying ? 'Classifying...' : 'Classify (stub)'}
            </button>
            {!classifyPromptVersion && (
              <span className="text-sm text-gray-500">Loading prompt version...</span>
            )}
            <span className="text-sm text-blue-600">
              Assigns categories to all messages using deterministic stub algorithm
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

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md">
          <h2 className="text-xl font-semibold mb-4">Run</h2>
          <p className="text-gray-600 mb-4">
            Create summarization runs with frozen configs.
          </p>
          <span className="inline-block px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
            Coming in Phase 4
          </span>
        </div>

        <div className="p-6 bg-gray-50 border border-gray-200 rounded-md">
          <h2 className="text-xl font-semibold mb-4">Search</h2>
          <p className="text-gray-600 mb-4">
            Full-text search across atoms and outputs.
          </p>
          <span className="inline-block px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
            Coming in Phase 6
          </span>
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
