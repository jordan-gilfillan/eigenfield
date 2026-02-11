'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'

interface OutputData {
  outputText: string
  model: string
  promptVersionId: string
  createdAt: string
}

interface JournalEntryProps {
  runId: string
  dayDate: string
  jobStatus: string
  jobError: string | null
  jobTokensIn: number
  jobTokensOut: number
  jobCostUsd: number
}

function formatFullDate(dayDate: string): string {
  const [year, month, day] = dayDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function parseErrorMessage(errorJson: string | null): string {
  if (!errorJson) return 'An unknown error occurred.'
  try {
    const parsed = JSON.parse(errorJson)
    return parsed.message || 'An unknown error occurred.'
  } catch {
    return errorJson
  }
}

const markdownComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="text-lg font-medium text-gray-700 mt-6 mb-2" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="text-lg font-medium text-gray-700 mt-6 mb-2" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="text-base font-medium text-gray-700 mt-4 mb-2" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="mb-4" {...props}>{children}</p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="ml-4 list-disc space-y-1 mb-4" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="ml-4 list-decimal space-y-1 mb-4" {...props}>{children}</ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-2 border-gray-300 pl-4 italic text-gray-600 mb-4" {...props}>
      {children}
    </blockquote>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-gray-800" {...props}>{children}</strong>
  ),
}

export default function JournalEntry({
  runId,
  dayDate,
  jobStatus,
  jobError,
  jobTokensIn,
  jobTokensOut,
  jobCostUsd,
}: JournalEntryProps) {
  const [output, setOutput] = useState<OutputData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (jobStatus !== 'succeeded') {
      setOutput(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function loadOutput() {
      const res = await fetch(`/api/distill/runs/${runId}/jobs/${dayDate}/output`)
      if (cancelled) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error?.message || `Failed to load output (${res.status})`)
        setLoading(false)
        return
      }
      const data = await res.json()
      if (cancelled) return
      if (data.hasOutput && data.output) {
        setOutput({
          outputText: data.output.outputText,
          model: data.output.model,
          promptVersionId: data.output.promptVersionId,
          createdAt: data.output.createdAt,
        })
      } else {
        setError('No output available for this day.')
      }
      setLoading(false)
    }

    loadOutput()
    return () => { cancelled = true }
  }, [runId, dayDate, jobStatus])

  return (
    <div className="px-8 py-6">
      <h1 className="text-2xl font-light text-gray-700 tracking-wide mb-6">
        {formatFullDate(dayDate)}
      </h1>

      {jobStatus === 'succeeded' && loading && (
        <p className="text-sm text-gray-400">Loading entry...</p>
      )}

      {jobStatus === 'succeeded' && error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {jobStatus === 'succeeded' && output && (
        <>
          <div className="max-w-[65ch] text-gray-800 leading-relaxed">
            <ReactMarkdown components={markdownComponents}>
              {output.outputText}
            </ReactMarkdown>
          </div>

          <div className="text-xs text-gray-400 mt-8 pt-4 border-t border-gray-100 space-y-0.5 max-w-[65ch]">
            <div>
              {output.model} &middot; {jobTokensIn.toLocaleString()} in &middot; {jobTokensOut.toLocaleString()} out &middot; ${jobCostUsd.toFixed(4)}
            </div>
            <div>
              prompt: {output.promptVersionId.slice(0, 7)}&hellip; &middot; generated {new Date(output.createdAt).toLocaleString()}
            </div>
          </div>
        </>
      )}

      {jobStatus === 'failed' && (
        <div className="max-w-[65ch]">
          <div className="bg-red-50 border border-red-100 rounded-lg p-4">
            <p className="text-sm text-red-700 font-medium mb-1">This day failed to process</p>
            <p className="text-sm text-red-600">{parseErrorMessage(jobError)}</p>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Use Resume in the status bar to requeue failed jobs, or inspect details in Workbench.
          </p>
        </div>
      )}

      {jobStatus === 'queued' && (
        <p className="text-sm text-gray-400">Waiting to be processed.</p>
      )}

      {jobStatus === 'running' && (
        <p className="text-sm text-blue-500">Processing...</p>
      )}

      {jobStatus === 'cancelled' && (
        <p className="text-sm text-gray-400">This day was cancelled.</p>
      )}
    </div>
  )
}
