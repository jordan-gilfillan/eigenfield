'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function DashboardContent() {
  const searchParams = useSearchParams()
  const importBatchId = searchParams.get('importBatchId')

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
          <p className="text-blue-600 text-sm mt-1">
            Classification and run creation coming in Phase 3+
          </p>
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
          <span className="inline-block px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
            Coming in Phase 3
          </span>
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
