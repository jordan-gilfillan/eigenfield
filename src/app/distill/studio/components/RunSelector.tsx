'use client'

import { useEffect, useState } from 'react'

interface RunItem {
  id: string
  status: string
  model: string
  createdAt: string
}

interface RunSelectorProps {
  selectedRunId: string
  onSelect: (runId: string) => void
}

export default function RunSelector({ selectedRunId, onSelect }: RunSelectorProps) {
  const [runs, setRuns] = useState<RunItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch('/api/distill/runs?limit=10')
      if (!res.ok || cancelled) return
      const data = await res.json()
      if (!cancelled) {
        setRuns(data.items ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="text-sm text-gray-400">Loading runs...</div>
  }

  if (runs.length === 0) {
    return <div className="text-sm text-gray-400">No runs available</div>
  }

  return (
    <select
      value={selectedRunId}
      onChange={(e) => onSelect(e.target.value)}
      className="text-sm border border-gray-200 rounded px-2 py-1.5 bg-white text-gray-700 w-full max-w-md"
    >
      {runs.map((run) => (
        <option key={run.id} value={run.id}>
          {run.model} &middot; {run.status} &middot; {new Date(run.createdAt).toLocaleDateString()}
        </option>
      ))}
    </select>
  )
}
