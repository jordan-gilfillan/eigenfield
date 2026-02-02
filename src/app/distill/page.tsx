'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
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

function DashboardContent() {
  const searchParams = useSearchParams()
  const importBatchId = searchParams.get('importBatchId')

  const [classifyPromptVersion, setClassifyPromptVersion] = useState<PromptVersion | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null)
  const [classifyError, setClassifyError] = useState<string | null>(null)

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
        // Silently fail - we'll show an error when classify is clicked
      }
    }
    fetchPromptVersion()
  }, [])

  async function handleClassify() {
    if (!importBatchId || !classifyPromptVersion) return

    setClassifying(true)
    setClassifyError(null)
    setClassifyResult(null)

    try {
      const res = await fetch('/api/distill/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId,
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

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:underline">
          &larr; Home
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      {importBatchId && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-blue-700">
            Import batch selected: <code className="font-mono">{importBatchId}</code>
          </p>

          {classifyResult && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
              <p className="text-green-700 font-medium">Classification complete!</p>
              <ul className="text-green-600 text-sm mt-1 space-y-1">
                <li>Total atoms: {classifyResult.totals.messageAtoms}</li>
                <li>Newly labeled: {classifyResult.totals.newlyLabeled}</li>
                <li>Already labeled: {classifyResult.totals.skippedAlreadyLabeled}</li>
                <li>
                  Label spec: {classifyResult.labelSpec.model} /{' '}
                  <code className="text-xs">{classifyResult.labelSpec.promptVersionId}</code>
                </li>
              </ul>
            </div>
          )}

          {classifyError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-red-700">{classifyError}</p>
            </div>
          )}

          <div className="mt-3 flex gap-2">
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
              <span className="text-sm text-gray-500 self-center">
                Loading prompt version...
              </span>
            )}
          </div>
        </div>
      )}

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
          {importBatchId ? (
            <span className="inline-block px-4 py-2 bg-green-100 text-green-700 rounded">
              Use button above to classify
            </span>
          ) : (
            <span className="inline-block px-4 py-2 bg-yellow-100 text-yellow-700 rounded">
              Import a batch first
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
