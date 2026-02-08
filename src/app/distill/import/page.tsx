'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ImportStats {
  message_count: number
  day_count: number
  coverage_start: string
  coverage_end: string
  per_source_counts: Record<string, number>
}

interface ImportResult {
  importBatch: {
    id: string
    createdAt: string
    source: string
    originalFilename: string
    fileSizeBytes: number
    timezone: string
    stats: ImportStats
  }
  created: {
    messageAtoms: number
    rawEntries: number
  }
  warnings: string[]
}

interface ApiError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [sourceOverride, setSourceOverride] = useState<string>('')
  const [timezone, setTimezone] = useState<string>('America/Los_Angeles')
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setStatus('idle')
      setResult(null)
      setError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setStatus('uploading')
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    if (sourceOverride) {
      formData.append('sourceOverride', sourceOverride)
    }
    if (timezone) {
      formData.append('timezone', timezone)
    }

    try {
      const response = await fetch('/api/distill/import', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        const apiError = data as ApiError
        setError(apiError.error.message)
        setStatus('error')
        return
      }

      setResult(data as ImportResult)
      setStatus('success')
    } catch (err) {
      setError('Failed to upload file. Please try again.')
      setStatus('error')
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Import Conversations</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* File input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Export File (JSON)
          </label>
          <input
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-2 text-sm text-gray-600">
              Selected: {file.name} ({formatBytes(file.size)})
            </p>
          )}
        </div>

        {/* Source override */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Source (optional - auto-detected if not specified)
          </label>
          <select
            value={sourceOverride}
            onChange={(e) => setSourceOverride(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">Auto-detect</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="grok">Grok</option>
          </select>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Timezone (for day bucketing)
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/New_York">Eastern (New York)</option>
            <option value="UTC">UTC</option>
            <option value="Europe/London">London</option>
            <option value="Europe/Paris">Paris</option>
            <option value="Asia/Tokyo">Tokyo</option>
          </select>
        </div>

        {/* Submit button */}
        <button
          type="submit"
          disabled={!file || status === 'uploading'}
          className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {status === 'uploading' ? 'Importing...' : 'Import'}
        </button>
      </form>

      {/* Error display */}
      {status === 'error' && error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Success display */}
      {status === 'success' && result && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-700 font-medium">Import successful!</p>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-700 font-medium mb-2">Warnings:</p>
              <ul className="list-disc list-inside text-yellow-600 text-sm">
                {result.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Import summary */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
            <h3 className="text-lg font-medium mb-4">Import Summary</h3>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-600">Filename:</dt>
              <dd>{result.importBatch.originalFilename}</dd>

              <dt className="text-gray-600">Size:</dt>
              <dd>{formatBytes(result.importBatch.fileSizeBytes)}</dd>

              <dt className="text-gray-600">Detected Source:</dt>
              <dd className="capitalize">{result.importBatch.source}</dd>

              <dt className="text-gray-600">Timezone:</dt>
              <dd>{result.importBatch.timezone}</dd>

              <dt className="text-gray-600">Date Coverage:</dt>
              <dd>
                {result.importBatch.stats.coverage_start} to{' '}
                {result.importBatch.stats.coverage_end}
              </dd>

              <dt className="text-gray-600">Total Messages:</dt>
              <dd>{result.importBatch.stats.message_count}</dd>

              <dt className="text-gray-600">Total Days:</dt>
              <dd>{result.importBatch.stats.day_count}</dd>

              <dt className="text-gray-600">Created Atoms:</dt>
              <dd>{result.created.messageAtoms}</dd>

              <dt className="text-gray-600">Created RawEntries:</dt>
              <dd>{result.created.rawEntries}</dd>
            </dl>

            {/* Per-source counts */}
            <div className="mt-4">
              <p className="text-gray-600 text-sm mb-2">Per-source counts:</p>
              <div className="flex gap-4">
                {Object.entries(result.importBatch.stats.per_source_counts).map(
                  ([source, count]) => (
                    <span
                      key={source}
                      className="px-2 py-1 bg-gray-200 rounded text-sm capitalize"
                    >
                      {source}: {count}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>

          {/* CTA to use this import */}
          <Link
            href={`/distill?importBatchId=${result.importBatch.id}`}
            className="block w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 text-center"
          >
            Use this import &rarr;
          </Link>
        </div>
      )}
    </main>
  )
}
