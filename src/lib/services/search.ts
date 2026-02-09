/**
 * Search service — Postgres FTS over MessageAtoms and Outputs
 *
 * Spec reference: 10.1, 10.3, 7.9 (GET /api/distill/search)
 *
 * Uses tsvector/tsquery with GIN indexes. Ordering is rank DESC
 * with stable tie-breakers (id) to guarantee deterministic paging.
 *
 * Cursor pagination: opaque base64-encoded JSON cursor containing
 * (rank, id) to allow keyset paging with no duplicates.
 */

import { prisma } from '@/lib/db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchScope = 'raw' | 'outputs'

export interface SearchParams {
  q: string
  scope: SearchScope
  limit: number
  cursor?: string
  importBatchId?: string
  runId?: string
  startDate?: string // YYYY-MM-DD
  endDate?: string   // YYYY-MM-DD
  sources?: string[]     // API-cased (lowercase), e.g. ['chatgpt', 'claude']
  categories?: string[]  // API-cased (lowercase), e.g. ['work', 'learning']
  labelModel?: string
  labelPromptVersionId?: string
}

interface CursorPayload {
  rank: number
  id: string
}

export interface AtomSearchResult {
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

export interface OutputSearchResult {
  resultType: 'output'
  rank: number
  snippet: string
  output: {
    runId: string
    dayDate: string
    stage: string
  }
}

export type SearchResult = AtomSearchResult | OutputSearchResult

export interface SearchResponse {
  items: SearchResult[]
  nextCursor?: string
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8')
    const parsed = JSON.parse(json)
    if (typeof parsed.rank !== 'number' || typeof parsed.id !== 'string') {
      throw new Error('Invalid cursor shape')
    }
    return parsed as CursorPayload
  } catch {
    throw new Error('Invalid cursor')
  }
}

// ---------------------------------------------------------------------------
// Search: raw scope (MessageAtoms)
// ---------------------------------------------------------------------------

async function resolveLabelContext(
  params: SearchParams
): Promise<{ model: string; promptVersionId: string } | null> {
  // Explicit label params take precedence
  if (params.labelModel && params.labelPromptVersionId) {
    return { model: params.labelModel, promptVersionId: params.labelPromptVersionId }
  }
  // If runId provided, look up the Run's config.labelSpec
  if (params.runId) {
    const run = await prisma.run.findUnique({
      where: { id: params.runId },
      select: { configJson: true },
    })
    if (run?.configJson) {
      const config = run.configJson as { labelSpec?: { model?: string; promptVersionId?: string } }
      if (config.labelSpec?.model && config.labelSpec?.promptVersionId) {
        return { model: config.labelSpec.model, promptVersionId: config.labelSpec.promptVersionId }
      }
    }
  }
  return null
}

async function searchRaw(params: SearchParams): Promise<SearchResponse> {
  const { q, limit, cursor, importBatchId, startDate, endDate, sources, categories } = params

  const labelCtx = await resolveLabelContext(params)

  // Build WHERE conditions
  const conditions: string[] = [
    `ma."text_search" @@ plainto_tsquery('english', $1)`,
  ]
  const values: unknown[] = [q]
  let paramIndex = 2

  if (importBatchId) {
    conditions.push(`ma."importBatchId" = $${paramIndex}`)
    values.push(importBatchId)
    paramIndex++
  }
  if (startDate) {
    conditions.push(`ma."dayDate" >= $${paramIndex}::date`)
    values.push(startDate)
    paramIndex++
  }
  if (endDate) {
    conditions.push(`ma."dayDate" <= $${paramIndex}::date`)
    values.push(endDate)
    paramIndex++
  }

  // Sources filter: match atom source against provided values (cast to "Source" enum)
  if (sources && sources.length > 0) {
    const placeholders = sources.map((_, i) => `$${paramIndex + i}::"Source"`).join(', ')
    conditions.push(`ma."source" IN (${placeholders})`)
    sources.forEach((s) => values.push(s.toUpperCase()))
    paramIndex += sources.length
  }

  // Categories filter: match label category against provided values (cast to "Category" enum)
  if (categories && categories.length > 0) {
    if (labelCtx) {
      // Label JOIN will be present — filter on the joined label's category
      const placeholders = categories.map((_, i) => `$${paramIndex + i}::"Category"`).join(', ')
      conditions.push(`ml."category" IN (${placeholders})`)
      categories.forEach((c) => values.push(c.toUpperCase()))
      paramIndex += categories.length
    } else {
      // No label context — use EXISTS subquery against any label
      const placeholders = categories.map((_, i) => `$${paramIndex + i}::"Category"`).join(', ')
      conditions.push(
        `EXISTS (SELECT 1 FROM "message_labels" ml2 WHERE ml2."messageAtomId" = ma."id" AND ml2."category" IN (${placeholders}))`
      )
      categories.forEach((c) => values.push(c.toUpperCase()))
      paramIndex += categories.length
    }
  }

  // Cursor-based keyset pagination: rank DESC, id ASC
  // Next-page condition: rank < cursor_rank OR (rank = cursor_rank AND id > cursor_id)
  if (cursor) {
    const c = decodeCursor(cursor)
    conditions.push(
      `(ts_rank(ma."text_search", plainto_tsquery('english', $1)) < $${paramIndex}::real OR (ts_rank(ma."text_search", plainto_tsquery('english', $1)) = $${paramIndex}::real AND ma."id" > $${paramIndex + 1}::text))`
    )
    values.push(c.rank, c.id)
    paramIndex += 2
  }

  const whereClause = conditions.join(' AND ')

  // Build label JOIN clause when label context is available
  let labelJoin = ''
  let labelSelect = 'NULL::text AS label_category, NULL::float AS label_confidence'
  if (labelCtx) {
    labelJoin = `LEFT JOIN "message_labels" ml ON ml."messageAtomId" = ma."id" AND ml."model" = $${paramIndex} AND ml."promptVersionId" = $${paramIndex + 1}`
    labelSelect = 'ml."category" AS label_category, ml."confidence" AS label_confidence'
    values.push(labelCtx.model, labelCtx.promptVersionId)
    paramIndex += 2
  }

  // Fetch limit + 1 to detect next page
  const sql = `
    SELECT
      ma."id",
      ma."atomStableId",
      ma."importBatchId",
      ma."source",
      ma."dayDate",
      ma."timestampUtc",
      ma."role",
      ${labelSelect},
      ts_rank(ma."text_search", plainto_tsquery('english', $1)) AS rank,
      ts_headline('english', ma."text", plainto_tsquery('english', $1),
        'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15, MaxFragments=1') AS snippet
    FROM "message_atoms" ma
    ${labelJoin}
    WHERE ${whereClause}
    ORDER BY rank DESC, ma."id" ASC
    LIMIT ${limit + 1}
  `

  const rows: Array<{
    id: string
    atomStableId: string
    importBatchId: string
    source: string
    dayDate: Date
    timestampUtc: Date
    role: string
    label_category: string | null
    label_confidence: number | null
    rank: number
    snippet: string
  }> = await prisma.$queryRawUnsafe(sql, ...values)

  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows

  const items: AtomSearchResult[] = resultRows.map((row) => ({
    resultType: 'atom' as const,
    rank: row.rank,
    snippet: row.snippet,
    atom: {
      atomStableId: row.atomStableId,
      importBatchId: row.importBatchId,
      source: row.source.toLowerCase(),
      dayDate: formatDate(row.dayDate),
      timestampUtc: row.timestampUtc instanceof Date
        ? row.timestampUtc.toISOString()
        : String(row.timestampUtc),
      role: row.role.toLowerCase(),
      category: row.label_category?.toLowerCase() ?? null,
      confidence: row.label_confidence,
    },
  }))

  const nextCursor = hasMore && resultRows.length > 0
    ? encodeCursor({
        rank: resultRows[resultRows.length - 1].rank,
        id: resultRows[resultRows.length - 1].id,
      })
    : undefined

  return { items, nextCursor }
}

// ---------------------------------------------------------------------------
// Search: outputs scope
// ---------------------------------------------------------------------------

async function searchOutputs(params: SearchParams): Promise<SearchResponse> {
  const { q, limit, cursor, runId, startDate, endDate } = params

  // Build WHERE conditions
  const conditions: string[] = [
    `o."output_text_search" @@ plainto_tsquery('english', $1)`,
  ]
  const values: unknown[] = [q]
  let paramIndex = 2

  if (runId) {
    conditions.push(`j."runId" = $${paramIndex}`)
    values.push(runId)
    paramIndex++
  }
  if (startDate) {
    conditions.push(`j."dayDate" >= $${paramIndex}::date`)
    values.push(startDate)
    paramIndex++
  }
  if (endDate) {
    conditions.push(`j."dayDate" <= $${paramIndex}::date`)
    values.push(endDate)
    paramIndex++
  }

  // Cursor-based keyset pagination: rank DESC, id ASC
  if (cursor) {
    const c = decodeCursor(cursor)
    conditions.push(
      `(ts_rank(o."output_text_search", plainto_tsquery('english', $1)) < $${paramIndex}::real OR (ts_rank(o."output_text_search", plainto_tsquery('english', $1)) = $${paramIndex}::real AND o."id" > $${paramIndex + 1}::text))`
    )
    values.push(c.rank, c.id)
    paramIndex += 2
  }

  const whereClause = conditions.join(' AND ')

  const sql = `
    SELECT
      o."id",
      o."stage",
      j."runId",
      j."dayDate",
      ts_rank(o."output_text_search", plainto_tsquery('english', $1)) AS rank,
      ts_headline('english', o."outputText", plainto_tsquery('english', $1),
        'StartSel=<<, StopSel=>>, MaxWords=35, MinWords=15, MaxFragments=1') AS snippet
    FROM "outputs" o
    JOIN "jobs" j ON o."jobId" = j."id"
    WHERE ${whereClause}
    ORDER BY rank DESC, o."id" ASC
    LIMIT ${limit + 1}
  `

  const rows: Array<{
    id: string
    stage: string
    runId: string
    dayDate: Date
    rank: number
    snippet: string
  }> = await prisma.$queryRawUnsafe(sql, ...values)

  const hasMore = rows.length > limit
  const resultRows = hasMore ? rows.slice(0, limit) : rows

  const items: OutputSearchResult[] = resultRows.map((row) => ({
    resultType: 'output' as const,
    rank: row.rank,
    snippet: row.snippet,
    output: {
      runId: row.runId,
      dayDate: formatDate(row.dayDate),
      stage: row.stage.toLowerCase(),
    },
  }))

  const nextCursor = hasMore && resultRows.length > 0
    ? encodeCursor({
        rank: resultRows[resultRows.length - 1].rank,
        id: resultRows[resultRows.length - 1].id,
      })
    : undefined

  return { items, nextCursor }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function search(params: SearchParams): Promise<SearchResponse> {
  if (params.scope === 'raw') {
    return searchRaw(params)
  }
  return searchOutputs(params)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  // Format as YYYY-MM-DD using UTC to avoid timezone shift on DATE columns
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
