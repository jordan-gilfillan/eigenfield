'use client'

import Link from 'next/link'
import { Suspense, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Types (mirrors API response from GET /api/distill/search)
// ---------------------------------------------------------------------------

interface AtomResult {
  resultType: 'atom'
  rank: number
  snippet: string
  atom: {
    atomStableId: string
    importBatchId: string
    source: string
    dayDate: string
    timestampUtc: string
    role: string
    category: string | null
    confidence: number | null
  }
}

interface OutputResult {
  resultType: 'output'
  rank: number
  snippet: string
  output: {
    runId: string
    dayDate: string
    stage: string
  }
}

type SearchResult = AtomResult | OutputResult

type Scope = 'raw' | 'outputs'

interface SearchState {
  status: 'idle' | 'loading' | 'success' | 'error'
  items: SearchResult[]
  nextCursor: string | undefined
  error: string | null
  loadingMore: boolean
}

const LIMIT = 25

// ---------------------------------------------------------------------------
// Snippet rendering: API uses << >> as highlight markers
// ---------------------------------------------------------------------------

function SnippetText({ snippet }: { snippet: string }) {
  // Split on <<...>> markers and render highlights
  const parts = snippet.split(/(<<.*?>>)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('<<') && part.endsWith('>>')) {
          return (
            <mark key={i} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
              {part.slice(2, -2)}
            </mark>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Result card components
// ---------------------------------------------------------------------------

function AtomResultCard({ result }: { result: AtomResult }) {
  const { atom } = result
  // Link to import inspector day view (PR-6.3)
  const href = `/distill/import/inspect?importBatchId=${atom.importBatchId}&dayDate=${atom.dayDate}&source=${atom.source}`

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-md hover:border-blue-300 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
          raw
        </span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 capitalize">
          {atom.source}
        </span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          {atom.role}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{atom.dayDate}</span>
      </div>
      <div className="text-sm text-gray-700 mb-2 leading-relaxed">
        <SnippetText snippet={result.snippet} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono truncate max-w-[200px]">
          {atom.atomStableId.slice(0, 16)}...
        </span>
        <Link
          href={href}
          className="text-xs text-blue-600 hover:underline"
        >
          View day &rarr;
        </Link>
      </div>
    </div>
  )
}

function OutputResultCard({ result }: { result: OutputResult }) {
  const { output } = result
  // Link to run detail page (existing Phase 5 UI)
  const href = `/distill/runs/${output.runId}?day=${output.dayDate}`

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-md hover:border-blue-300 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          output
        </span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
          {output.stage}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{output.dayDate}</span>
      </div>
      <div className="text-sm text-gray-700 mb-2 leading-relaxed">
        <SnippetText snippet={result.snippet} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono truncate max-w-[200px]">
          run: {output.runId.slice(0, 16)}...
        </span>
        <Link
          href={href}
          className="text-xs text-blue-600 hover:underline"
        >
          View output &rarr;
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main search content
// ---------------------------------------------------------------------------

function SearchContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // URL-driven initial state
  const initialQ = searchParams.get('q') || ''
  const initialScope = (searchParams.get('scope') as Scope) || 'raw'

  const [query, setQuery] = useState(initialQ)
  const [scope, setScope] = useState<Scope>(initialScope)
  const [state, setState] = useState<SearchState>({
    status: initialQ ? 'idle' : 'idle',
    items: [],
    nextCursor: undefined,
    error: null,
    loadingMore: false,
  })

  // Fetch search results (user-driven, no background polling)
  const doSearch = useCallback(
    async (q: string, s: Scope, cursor?: string) => {
      const params = new URLSearchParams()
      params.set('q', q)
      params.set('scope', s)
      params.set('limit', String(LIMIT))
      if (cursor) {
        params.set('cursor', cursor)
      }

      const res = await fetch(`/api/distill/search?${params}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error?.message || 'Search failed')
      }

      return data as { items: SearchResult[]; nextCursor?: string }
    },
    []
  )

  // Handle form submit (new search)
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = query.trim()
      if (!trimmed) return

      // Update URL for shareability
      router.push(`/distill/search?q=${encodeURIComponent(trimmed)}&scope=${scope}`)

      setState((prev) => ({
        ...prev,
        status: 'loading',
        items: [],
        nextCursor: undefined,
        error: null,
        loadingMore: false,
      }))

      try {
        const data = await doSearch(trimmed, scope)
        setState({
          status: 'success',
          items: data.items,
          nextCursor: data.nextCursor,
          error: null,
          loadingMore: false,
        })
      } catch (err) {
        setState({
          status: 'error',
          items: [],
          nextCursor: undefined,
          error: err instanceof Error ? err.message : 'Search failed',
          loadingMore: false,
        })
      }
    },
    [query, scope, doSearch, router]
  )

  // Handle Load More (cursor pagination, appends to existing results)
  const handleLoadMore = useCallback(async () => {
    if (!state.nextCursor || state.loadingMore) return

    setState((prev) => ({ ...prev, loadingMore: true }))

    try {
      const trimmed = query.trim()
      const data = await doSearch(trimmed, scope, state.nextCursor)
      setState((prev) => ({
        ...prev,
        items: [...prev.items, ...data.items],
        nextCursor: data.nextCursor,
        loadingMore: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to load more',
        loadingMore: false,
      }))
    }
  }, [state.nextCursor, state.loadingMore, query, scope, doSearch])

  // Handle scope tab change — clears results, user must re-submit
  const handleScopeChange = useCallback((newScope: Scope) => {
    setScope(newScope)
    setState({
      status: 'idle',
      items: [],
      nextCursor: undefined,
      error: null,
      loadingMore: false,
    })
  }, [])

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <Link href="/distill" className="text-blue-600 hover:underline">
          &larr; Dashboard
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-6">Search</h1>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages and outputs..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={state.status === 'loading' || !query.trim()}
            className={`px-6 py-2 rounded-md font-medium text-white ${
              state.status === 'loading' || !query.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {state.status === 'loading' ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Scope tabs */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        <ScopeTab
          label="Raw"
          value="raw"
          current={scope}
          onClick={handleScopeChange}
        />
        <ScopeTab
          label="Outputs"
          value="outputs"
          current={scope}
          onClick={handleScopeChange}
        />
      </div>

      {/* Error */}
      {state.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{state.error}</p>
        </div>
      )}

      {/* Loading */}
      {state.status === 'loading' && (
        <div className="text-gray-500 text-sm">Searching...</div>
      )}

      {/* Results */}
      {state.status === 'success' && (
        <>
          {state.items.length === 0 ? (
            <div className="text-gray-500 text-sm p-4 bg-gray-50 rounded-md">
              No results found for &quot;{query.trim()}&quot; in {scope === 'raw' ? 'raw messages' : 'outputs'}.
            </div>
          ) : (
            <>
              <div className="text-sm text-gray-500 mb-4">
                {state.items.length} result{state.items.length !== 1 ? 's' : ''} shown
              </div>

              <div className="space-y-3">
                {state.items.map((item, index) => {
                  if (item.resultType === 'atom') {
                    return (
                      <AtomResultCard
                        key={`atom-${(item as AtomResult).atom.atomStableId}-${index}`}
                        result={item as AtomResult}
                      />
                    )
                  }
                  return (
                    <OutputResultCard
                      key={`output-${(item as OutputResult).output.runId}-${(item as OutputResult).output.dayDate}-${index}`}
                      result={item as OutputResult}
                    />
                  )
                })}
              </div>

              {/* Load More */}
              {state.nextCursor && (
                <div className="mt-6 text-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={state.loadingMore}
                    className={`px-6 py-2 rounded-md font-medium ${
                      state.loadingMore
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                    }`}
                  >
                    {state.loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Scope tab component
// ---------------------------------------------------------------------------

function ScopeTab({
  label,
  value,
  current,
  onClick,
}: {
  label: string
  value: Scope
  current: Scope
  onClick: (scope: Scope) => void
}) {
  const isActive = value === current
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        isActive
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page export with Suspense boundary (required for useSearchParams)
// ---------------------------------------------------------------------------

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
