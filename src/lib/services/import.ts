/**
 * Import Service
 *
 * Handles importing conversation exports into the database.
 * Creates ImportBatch, MessageAtoms, and RawEntries.
 *
 * Spec references: 7.1 (Import), 6.1-6.5 (Data Model)
 */

import { prisma } from '../db'
import { parseExport, type ParsedMessage } from '../parsers'
import { computeAtomStableId, computeTextHash } from '../stableId'
import { extractDayDate } from '../timestamp'
import { buildRawEntryContent, computeRawEntryHash } from '../rawEntry'
import { sourceToDb, sourceToApi, roleToApi, roleToDb, categoryToApi, type SourceApi } from '../enums'
import type { Source, Role, Category } from '@prisma/client'

/**
 * Default timezone per spec 7.1
 */
const DEFAULT_TIMEZONE = 'America/Los_Angeles'

export interface ImportOptions {
  /** Raw file content */
  content: string
  /** Original filename */
  filename: string
  /** File size in bytes */
  fileSizeBytes: number
  /** Optional source override (auto-detect if not specified) */
  sourceOverride?: SourceApi
  /** Optional timezone override (defaults to America/Los_Angeles) */
  timezone?: string
}

export interface ImportStats {
  message_count: number
  day_count: number
  coverage_start: string // YYYY-MM-DD
  coverage_end: string // YYYY-MM-DD
  per_source_counts: Record<string, number>
}

export interface ImportResult {
  importBatch: {
    id: string
    createdAt: Date
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

/**
 * Groups messages by (source, dayDate) for RawEntry creation.
 */
function groupBySourceAndDay(
  messages: Array<{
    source: Source
    dayDate: string
    atomStableId: string
    timestampUtc: Date
    role: Role
    text: string
  }>
): Map<string, typeof messages> {
  const groups = new Map<string, typeof messages>()

  for (const msg of messages) {
    const key = `${msg.source}|${msg.dayDate}`
    const group = groups.get(key) ?? []
    group.push(msg)
    groups.set(key, group)
  }

  return groups
}

/**
 * Imports a conversation export file.
 *
 * Per spec:
 * - Creates ImportBatch with stats
 * - Creates MessageAtoms with atomStableId (deduplicates by atomStableId)
 * - Creates RawEntries per (source, dayDate)
 * - Does NOT auto-classify (v0.3 default)
 */
export async function importExport(options: ImportOptions): Promise<ImportResult> {
  const { content, filename, fileSizeBytes, sourceOverride, timezone = DEFAULT_TIMEZONE } = options

  // Parse the export
  const parseResult = parseExport(content, sourceOverride)
  const warnings = [...parseResult.warnings]

  if (parseResult.messages.length === 0) {
    throw new Error('No messages found in export file')
  }

  // Prepare atoms data
  const atomsData = parseResult.messages.map((msg: ParsedMessage) => {
    const dayDate = extractDayDate(msg.timestampUtc, timezone)
    const atomStableId = computeAtomStableId({
      source: msg.source,
      sourceConversationId: msg.sourceConversationId,
      sourceMessageId: msg.sourceMessageId,
      timestampUtc: msg.timestampUtc,
      role: msg.role,
      text: msg.text,
    })
    const textHash = computeTextHash(msg.text)

    return {
      atomStableId,
      source: sourceToDb(msg.source) as Source,
      sourceConversationId: msg.sourceConversationId,
      sourceMessageId: msg.sourceMessageId,
      timestampUtc: msg.timestampUtc,
      dayDate,
      role: roleToDb(msg.role) as Role,
      text: msg.text,
      textHash,
    }
  })

  // Calculate stats before insert
  const uniqueDays = new Set(atomsData.map((a) => a.dayDate))
  const sortedDays = Array.from(uniqueDays).sort()
  const perSourceCounts: Record<string, number> = {}
  for (const atom of atomsData) {
    const source = atom.source.toLowerCase()
    perSourceCounts[source] = (perSourceCounts[source] ?? 0) + 1
  }

  const stats = {
    message_count: atomsData.length,
    day_count: uniqueDays.size,
    coverage_start: sortedDays[0],
    coverage_end: sortedDays[sortedDays.length - 1],
    per_source_counts: perSourceCounts,
  } satisfies ImportStats

  // Check for existing atoms BEFORE the transaction to avoid Postgres transaction abort
  const existingAtomIds = await prisma.messageAtom.findMany({
    where: {
      atomStableId: { in: atomsData.map((a) => a.atomStableId) },
    },
    select: { atomStableId: true },
  })
  const existingSet = new Set(existingAtomIds.map((a) => a.atomStableId))

  // Filter to only new atoms
  const newAtomsData = atomsData.filter((a) => !existingSet.has(a.atomStableId))
  const skippedDuplicates = atomsData.length - newAtomsData.length

  if (skippedDuplicates > 0) {
    warnings.push(
      `Skipped ${skippedDuplicates} duplicate messages (already imported)`
    )
  }

  // Use a transaction to ensure atomicity
  // Increase timeout for large imports (default is 5s)
  const result = await prisma.$transaction(
    async (tx) => {
      // Create ImportBatch
      const importBatch = await tx.importBatch.create({
        data: {
          source: sourceToDb(parseResult.source) as Source,
          originalFilename: filename,
          fileSizeBytes,
          timezone,
          statsJson: stats,
        },
      })

      // Create MessageAtoms (only new ones)
      // Use skipDuplicates for concurrency safety - safe because uniqueness is on atomStableId (spec 6.2)
      if (newAtomsData.length > 0) {
        await tx.messageAtom.createMany({
          data: newAtomsData.map((atomData) => ({
            ...atomData,
            dayDate: new Date(atomData.dayDate),
            importBatchId: importBatch.id,
          })),
          skipDuplicates: true,
        })
      }

      // Create RawEntries per (source, dayDate)
      // Only for atoms that were actually created in this import
      const atomsForRawEntry = newAtomsData.map((a) => ({
        ...a,
        role: a.role,
      }))

      const groups = groupBySourceAndDay(
        atomsForRawEntry as Array<{
          source: Source
          dayDate: string
          atomStableId: string
          timestampUtc: Date
          role: Role
          text: string
        }>
      )

      let createdRawEntries = 0

      for (const [key, atoms] of groups) {
        const [source, dayDate] = key.split('|')
        const contentText = buildRawEntryContent(
          atoms.map((a) => ({
            atomStableId: a.atomStableId,
            timestampUtc: a.timestampUtc,
            role: a.role.toLowerCase(),
            text: a.text,
          }))
        )
        const contentHash = computeRawEntryHash(contentText)

        await tx.rawEntry.create({
          data: {
            importBatchId: importBatch.id,
            source: source as Source,
            dayDate: new Date(dayDate),
            contentText,
            contentHash,
          },
        })
        createdRawEntries++
      }

      return {
        importBatch,
        createdAtoms: newAtomsData.length,
        createdRawEntries,
      }
    },
    {
      timeout: 120000, // 2 minutes for large imports
    }
  )

  return {
    importBatch: {
      id: result.importBatch.id,
      createdAt: result.importBatch.createdAt,
      source: result.importBatch.source.toLowerCase(),
      originalFilename: result.importBatch.originalFilename,
      fileSizeBytes: result.importBatch.fileSizeBytes,
      timezone: result.importBatch.timezone,
      stats,
    },
    created: {
      messageAtoms: result.createdAtoms,
      rawEntries: result.createdRawEntries,
    },
    warnings,
  }
}

/**
 * Gets an ImportBatch by ID with its stats.
 */
export async function getImportBatch(id: string) {
  const batch = await prisma.importBatch.findUnique({
    where: { id },
  })

  if (!batch) return null

  return {
    id: batch.id,
    createdAt: batch.createdAt,
    source: batch.source.toLowerCase(),
    originalFilename: batch.originalFilename,
    fileSizeBytes: batch.fileSizeBytes,
    timezone: batch.timezone,
    stats: batch.statsJson as unknown as ImportStats,
  }
}

/**
 * Lists ImportBatches with pagination.
 */
export async function listImportBatches(options: {
  limit?: number
  cursor?: string
}) {
  const { limit = 50, cursor } = options

  const batches = await prisma.importBatch.findMany({
    take: limit + 1, // Fetch one extra to determine if there's more
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0, // Skip the cursor itself
    orderBy: { createdAt: 'desc' },
  })

  const hasMore = batches.length > limit
  const items = hasMore ? batches.slice(0, limit) : batches
  const nextCursor = hasMore ? items[items.length - 1].id : undefined

  return {
    items: items.map((batch) => ({
      id: batch.id,
      createdAt: batch.createdAt,
      source: batch.source.toLowerCase(),
      originalFilename: batch.originalFilename,
      fileSizeBytes: batch.fileSizeBytes,
      timezone: batch.timezone,
      stats: batch.statsJson as unknown as ImportStats,
    })),
    nextCursor,
  }
}

// =============================================================================
// Import Inspector (PR-6.3)
// =============================================================================

export interface DayInfo {
  dayDate: string // YYYY-MM-DD
  atomCount: number
  sources: string[] // lowercase
}

/**
 * Gets the list of available days for an ImportBatch with coverage info.
 *
 * Returns days in ASC order (deterministic).
 *
 * Spec reference: 10.2 (Import inspector day list)
 */
export async function getImportBatchDays(importBatchId: string): Promise<DayInfo[]> {
  // Verify batch exists
  const batch = await prisma.importBatch.findUnique({
    where: { id: importBatchId },
    select: { id: true },
  })
  if (!batch) return []

  // Aggregate days with counts and sources, ordered ASC
  const rows = await prisma.$queryRaw<
    Array<{ day_date: Date; atom_count: bigint; sources: string }>
  >`
    SELECT
      "dayDate" AS day_date,
      COUNT(*)::bigint AS atom_count,
      STRING_AGG(DISTINCT LOWER(source::text), ',' ORDER BY LOWER(source::text)) AS sources
    FROM "message_atoms"
    WHERE "importBatchId" = ${importBatchId}
    GROUP BY "dayDate"
    ORDER BY "dayDate" ASC
  `

  return rows.map((row) => ({
    dayDate: formatDate(row.day_date),
    atomCount: Number(row.atom_count),
    sources: row.sources.split(','),
  }))
}

export interface AtomView {
  atomStableId: string
  source: string // lowercase
  timestampUtc: string // RFC3339
  role: string // lowercase
  text: string
  category: string | null // lowercase, from latest label if available
  confidence: number | null
}

/**
 * Gets atoms for a specific day in an ImportBatch with deterministic ordering.
 *
 * Ordering per spec 6.5 / 9.1:
 *   timestampUtc ASC, role ASC (user before assistant), atomStableId ASC
 *
 * Optionally filters by source.
 *
 * Spec reference: 10.2 (Import inspector per-day view)
 */
export async function getImportBatchDayAtoms(options: {
  importBatchId: string
  dayDate: string // YYYY-MM-DD
  source?: string // lowercase
}): Promise<AtomView[]> {
  const { importBatchId, dayDate, source } = options

  // Build where clause
  const where: Record<string, unknown> = {
    importBatchId,
    dayDate: new Date(dayDate),
  }
  if (source) {
    where.source = sourceToDb(source as SourceApi)
  }

  const atoms = await prisma.messageAtom.findMany({
    where,
    include: {
      messageLabels: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: [
      { timestampUtc: 'asc' },
      { role: 'asc' }, // Prisma enum: ASSISTANT < USER alphabetically — corrected below
      { atomStableId: 'asc' },
    ],
  })

  // Prisma sorts Role enum alphabetically: ASSISTANT < USER.
  // Spec requires user before assistant. Re-sort in memory for correctness.
  atoms.sort((a, b) => {
    // Primary: timestampUtc ASC
    const tA = a.timestampUtc.getTime()
    const tB = b.timestampUtc.getTime()
    if (tA !== tB) return tA - tB

    // Secondary: role ASC (user before assistant)
    const roleOrder = { USER: 0, ASSISTANT: 1 } as const
    const rA = roleOrder[a.role]
    const rB = roleOrder[b.role]
    if (rA !== rB) return rA - rB

    // Tie-breaker: atomStableId ASC
    return a.atomStableId.localeCompare(b.atomStableId)
  })

  return atoms.map((atom) => {
    const label = atom.messageLabels[0] ?? null
    return {
      atomStableId: atom.atomStableId,
      source: sourceToApi(atom.source as Parameters<typeof sourceToApi>[0]),
      timestampUtc: atom.timestampUtc.toISOString(),
      role: roleToApi(atom.role as Parameters<typeof roleToApi>[0]),
      text: atom.text,
      category: label ? categoryToApi(label.category as Category) : null,
      confidence: label ? label.confidence : null,
    }
  })
}

/**
 * Formats a Date as YYYY-MM-DD using UTC fields.
 */
function formatDate(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
