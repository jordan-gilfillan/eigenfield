'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface PreviewItem {
  atomStableId: string
  source: string
  timestampUtc: string
  role: string
  text: string
}

interface InputData {
  hasInput: boolean
  bundlePreviewText: string | null
  bundleHash: string
  bundleContextHash: string
  atomCount: number
  previewItems?: PreviewItem[]
  rawBundleJson: object | null
}

interface OutputData {
  outputText: string
  model: string
  promptVersionId: string
  bundleHash: string
  bundleContextHash: string
  createdAt: string
  segmented: boolean
  segmentCount: number | null
  atomCount: number | null
  rawOutputJson: object | null
}

interface InspectPanelProps {
  runId: string
  dayDate: string
  output: OutputData
}

function CollapsibleJson({ label, data }: { label: string; data: object | null }) {
  const [open, setOpen] = useState(false)

  if (!data) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <pre className="mt-1 text-xs text-gray-500 bg-gray-50 rounded p-3 overflow-x-auto max-h-64 overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

const markdownComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="text-sm font-medium text-gray-600 mt-4 mb-1" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="text-sm font-medium text-gray-600 mt-4 mb-1" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="text-sm font-medium text-gray-600 mt-3 mb-1" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-sm mb-2" {...props}>{children}</p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="ml-3 list-disc space-y-0.5 mb-2 text-sm" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="ml-3 list-decimal space-y-0.5 mb-2 text-sm" {...props}>{children}</ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-2 border-gray-200 pl-3 italic text-gray-500 mb-2 text-sm" {...props}>
      {children}
    </blockquote>
  ),
}

export default function InspectPanel({ runId, dayDate, output }: InspectPanelProps) {
  const [input, setInput] = useState<InputData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadInput() {
      const res = await fetch(`/api/distill/runs/${runId}/jobs/${dayDate}/input`)
      if (cancelled) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error?.message || `Failed to load input (${res.status})`)
        setLoading(false)
        return
      }
      const data = await res.json()
      if (cancelled) return
      setInput(data)
      setLoading(false)
    }

    loadInput()
    return () => { cancelled = true }
  }, [runId, dayDate])

  if (loading) {
    return (
      <div className="border-t border-gray-200 mt-6 pt-4">
        <p className="text-sm text-gray-400">Loading inspect data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-t border-gray-200 mt-6 pt-4">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="border-t border-gray-200 mt-6 pt-4">
      <div className="grid grid-cols-2 gap-6">
        {/* Left column: What the model saw */}
        <div>
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            What the model saw
          </h3>

          {input?.hasInput ? (
            <>
              <div className="font-mono text-sm text-gray-700 bg-gray-50 rounded p-3 max-h-96 overflow-y-auto whitespace-pre-wrap">
                {input.bundlePreviewText}
              </div>
              <div className="text-xs text-gray-400 mt-2 space-y-0.5">
                <div>{input.atomCount} atom{input.atomCount !== 1 ? 's' : ''}</div>
                <div className="font-mono">bundle: {input.bundleHash.slice(0, 12)}&hellip;</div>
                <div className="font-mono">context: {input.bundleContextHash.slice(0, 12)}&hellip;</div>
              </div>
              <CollapsibleJson label="Raw bundle JSON" data={input.rawBundleJson} />
            </>
          ) : (
            <p className="text-sm text-gray-400">No input bundle available.</p>
          )}
        </div>

        {/* Right column: What it produced */}
        <div>
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            What it produced
          </h3>

          <div className="text-sm text-gray-700 max-h-96 overflow-y-auto">
            <ReactMarkdown components={markdownComponents}>
              {output.outputText}
            </ReactMarkdown>
          </div>

          <div className="text-xs text-gray-400 mt-2 space-y-0.5">
            {output.segmented && (
              <div>
                {output.segmentCount} segment{output.segmentCount !== 1 ? 's' : ''}
              </div>
            )}
            {output.atomCount != null && (
              <div>{output.atomCount} atom{output.atomCount !== 1 ? 's' : ''} processed</div>
            )}
            <div className="font-mono">bundle: {output.bundleHash.slice(0, 12)}&hellip;</div>
          </div>
          <CollapsibleJson label="Raw output JSON" data={output.rawOutputJson} />
        </div>
      </div>
    </div>
  )
}
