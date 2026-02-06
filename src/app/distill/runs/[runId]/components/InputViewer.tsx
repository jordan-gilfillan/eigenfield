'use client'

import { useCallback, useState } from 'react'

interface PreviewItem {
  atomStableId: string
  source: string
  timestampUtc: string
  role: string
  text: string
}

interface InputData {
  hasInput: boolean
  runId: string
  dayDate: string
  bundlePreviewText: string | null
  bundleHash: string
  bundleContextHash: string
  atomCount: number
  previewItems?: PreviewItem[]
  rawBundleJson: unknown
}

interface InputViewerProps {
  runId: string
  dayDate: string
}

/**
 * InputViewer component for displaying the input bundle preview for a job day.
 *
 * Per spec 10.2 (PR-6.4):
 * - Shows the filtered bundle preview (monospace/preformatted, scrollable)
 * - Shows bundleHash + bundleContextHash prominently
 * - Includes a collapsible raw JSON viewer
 *
 * Reuses the same bundle construction as tick/job execution via the input API endpoint,
 * ensuring preview content + hashes align with Output hashes for succeeded jobs.
 */
export function InputViewer({ runId, dayDate }: InputViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inputData, setInputData] = useState<InputData | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)

  const fetchInput = useCallback(async () => {
    if (inputData) return // Already fetched

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/jobs/${dayDate}/input`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error?.message || 'Failed to load input')
        return
      }

      setInputData(data as InputData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load input')
    } finally {
      setIsLoading(false)
    }
  }, [runId, dayDate, inputData])

  const handleToggle = () => {
    if (!isExpanded) {
      fetchInput()
    }
    setIsExpanded(!isExpanded)
  }

  return (
    <div className="mt-1">
      <button
        onClick={handleToggle}
        className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
      >
        <span className="inline-block w-3 text-center">
          {isExpanded ? '▼' : '▶'}
        </span>
        {isExpanded ? 'Hide Input' : 'View Input'}
      </button>

      {isExpanded && (
        <div className="mt-3 border border-indigo-200 rounded-md bg-indigo-50/30">
          {isLoading && (
            <div className="p-4 text-sm text-gray-500">Loading input bundle...</div>
          )}

          {error && (
            <div className="p-4 text-sm text-red-600">Error: {error}</div>
          )}

          {inputData && !inputData.hasInput && (
            <div className="p-4 text-sm text-gray-500 italic">
              No eligible atoms for this day (hasInput: false).
            </div>
          )}

          {inputData?.hasInput && inputData.bundlePreviewText && (
            <div className="divide-y divide-indigo-100">
              {/* Bundle Hashes - prominent display */}
              <div className="p-4 bg-white">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  Input Bundle Metadata
                </h4>

                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-28 flex-shrink-0">Bundle Hash:</span>
                    <code className="bg-indigo-50 px-1.5 py-0.5 rounded font-mono break-all">
                      {inputData.bundleHash}
                    </code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-28 flex-shrink-0">Context Hash:</span>
                    <code className="bg-indigo-50 px-1.5 py-0.5 rounded font-mono break-all">
                      {inputData.bundleContextHash}
                    </code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-28 flex-shrink-0">Atom Count:</span>
                    <span className="font-medium">{inputData.atomCount}</span>
                  </div>
                </div>
              </div>

              {/* Bundle Preview Text (monospace, scrollable) */}
              <div className="p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  Bundle Preview
                </h4>
                <pre className="text-xs bg-white border border-gray-200 p-4 rounded font-mono overflow-auto max-h-96 whitespace-pre-wrap">
                  {inputData.bundlePreviewText}
                </pre>
              </div>

              {/* Raw JSON Section (collapsible) */}
              <div className="p-4 bg-gray-50">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
                >
                  <span className="inline-block w-3 text-center">
                    {showRawJson ? '▼' : '▶'}
                  </span>
                  Raw Bundle JSON
                </button>

                {showRawJson && (
                  <div className="mt-3">
                    <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto max-h-64">
                      {JSON.stringify(inputData.rawBundleJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
