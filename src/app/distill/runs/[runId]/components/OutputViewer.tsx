'use client'

import { useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface OutputData {
  id: string
  stage: string
  outputText: string
  model: string
  promptVersionId: string
  bundleHash: string
  bundleContextHash: string
  createdAt: string
  segmented: boolean
  segmentCount: number | null
  segmentIds: string[] | null
  atomCount: number | null
  estimatedInputTokens: number | null
  rawOutputJson: unknown
}

interface OutputResponse {
  runId: string
  dayDate: string
  jobStatus: string
  hasOutput: boolean
  output: OutputData | null
}

interface OutputViewerProps {
  runId: string
  dayDate: string
  jobStatus: string
}

/**
 * OutputViewer component for displaying job output.
 *
 * Per spec 7.5.1 (PR-5.4):
 * - Renders Output.outputText as markdown
 * - Shows bundleHash + bundleContextHash
 * - Shows segmentation metadata if present (segmented, segmentCount, segmentIds)
 * - Includes collapsible raw JSON viewer for Output.outputJson
 *
 * This component fetches output data on-demand when expanded,
 * avoiding loading all outputs in the run detail page.
 */
export function OutputViewer({ runId, dayDate, jobStatus }: OutputViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputData, setOutputData] = useState<OutputResponse | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)

  const canViewOutput = jobStatus === 'succeeded'

  const fetchOutput = useCallback(async () => {
    if (outputData) return // Already fetched

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/distill/runs/${runId}/jobs/${dayDate}/output`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error?.message || 'Failed to load output')
        return
      }

      setOutputData(data as OutputResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load output')
    } finally {
      setIsLoading(false)
    }
  }, [runId, dayDate, outputData])

  const handleToggle = () => {
    if (!isExpanded && canViewOutput) {
      fetchOutput()
    }
    setIsExpanded(!isExpanded)
  }

  if (!canViewOutput) {
    return (
      <div className="text-xs text-gray-400 italic">
        No output (job {jobStatus})
      </div>
    )
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleToggle}
        className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
      >
        <span className="inline-block w-3 text-center">
          {isExpanded ? '▼' : '▶'}
        </span>
        {isExpanded ? 'Hide Output' : 'View Output'}
      </button>

      {isExpanded && (
        <div className="mt-3 border border-gray-200 rounded-md bg-gray-50">
          {isLoading && (
            <div className="p-4 text-sm text-gray-500">Loading output...</div>
          )}

          {error && (
            <div className="p-4 text-sm text-red-600">Error: {error}</div>
          )}

          {outputData && !outputData.hasOutput && (
            <div className="p-4 text-sm text-gray-500 italic">
              No output available for this job.
            </div>
          )}

          {outputData?.hasOutput && outputData.output && (
            <div className="divide-y divide-gray-200">
              {/* Inspector Metadata Section */}
              <div className="p-4 bg-white">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  Inspector Metadata
                </h4>

                {/* Bundle Hashes */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-28 flex-shrink-0">Bundle Hash:</span>
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono break-all">
                      {outputData.output.bundleHash}
                    </code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 w-28 flex-shrink-0">Context Hash:</span>
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono break-all">
                      {outputData.output.bundleContextHash}
                    </code>
                  </div>
                </div>

                {/* Segmentation Metadata (if segmented) */}
                {outputData.output.segmented && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <h5 className="text-xs font-medium text-gray-600 mb-2">
                      Segmentation
                    </h5>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-28">Segmented:</span>
                        <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                          Yes
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-28">Segment Count:</span>
                        <span className="font-medium">
                          {outputData.output.segmentCount}
                        </span>
                      </div>
                      {outputData.output.segmentIds && (
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 w-28 flex-shrink-0">Segment IDs:</span>
                          <div className="space-y-1">
                            {outputData.output.segmentIds.map((id, idx) => (
                              <div key={id}>
                                <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">
                                  [{idx + 1}] {id}
                                </code>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Non-segmented badge */}
                {!outputData.output.segmented && (
                  <div className="mt-3 text-xs">
                    <span className="text-gray-500">Segmented: </span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                      No
                    </span>
                  </div>
                )}

                {/* Additional metadata */}
                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                  <div className="flex gap-4">
                    {outputData.output.atomCount !== null && (
                      <span>Atoms: {outputData.output.atomCount}</span>
                    )}
                    {outputData.output.estimatedInputTokens !== null && (
                      <span>Est. Tokens: {outputData.output.estimatedInputTokens.toLocaleString()}</span>
                    )}
                    <span>Model: {outputData.output.model}</span>
                  </div>
                </div>
              </div>

              {/* Markdown Output Section */}
              <div className="p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">
                  Output (Markdown)
                </h4>
                <div className="prose prose-sm max-w-none bg-white rounded border border-gray-200 p-4">
                  <ReactMarkdown>{outputData.output.outputText}</ReactMarkdown>
                </div>
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
                  Raw Output JSON
                </button>

                {showRawJson && (
                  <div className="mt-3">
                    <pre className="text-xs bg-gray-800 text-gray-100 p-3 rounded overflow-x-auto max-h-64">
                      {JSON.stringify(outputData.output.rawOutputJson, null, 2)}
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
