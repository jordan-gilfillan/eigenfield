/**
 * Bundle Construction Service
 *
 * Builds deterministic bundles from MessageAtoms for summarization.
 *
 * Spec references: 9.1 (Bundle ordering), 9.2 (Bundle size constraints), 5.3 (Bundle hash)
 */

import { prisma } from '../db'
import { sha256 } from '../hash'
import { toCanonicalTimestamp } from '../timestamp'
import type { Source, FilterMode } from '@prisma/client'

export interface BuildBundleOptions {
  /** Single batch (backward compat). Use importBatchIds for multi-batch. */
  importBatchId?: string
  /** Multiple batches (preferred). Atoms deduped by atomStableId per SPEC §9.1. */
  importBatchIds?: string[]
  dayDate: string // YYYY-MM-DD
  sources: string[] // lowercase
  labelSpec: {
    model: string
    promptVersionId: string
  }
  filterProfile: {
    mode: string // 'include' | 'exclude'
    categories: string[]
  }
}

export interface BundleResult {
  /** The deterministic bundle text */
  bundleText: string
  /** sha256("bundle_v1|" + bundleText) */
  bundleHash: string
  /** sha256 of context inputs */
  bundleContextHash: string
  /** Number of atoms in the bundle */
  atomCount: number
  /** Atom IDs included (for auditing) */
  atomIds: string[]
  /** Raw atoms for segmentation (in deterministic order) */
  atoms: Array<{
    id: string
    atomStableId: string
    source: string
    timestampUtc: Date
    role: string
    text: string
  }>
}

/**
 * Builds a deterministic bundle for a single day.
 *
 * Ordering per spec 9.1:
 * 1. source ASC
 * 2. timestampUtc ASC
 * 3. role ASC (user before assistant)
 * 4. atomStableId ASC (tie-breaker)
 *
 * Format:
 * ```
 * # SOURCE: <source>
 * [<timestampUtc>] <role>: <text>
 * ...
 *
 * # SOURCE: <next source>
 * ...
 * ```
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BundleResult> {
  const { dayDate, sources, labelSpec, filterProfile } = options

  // Normalize importBatchId/importBatchIds → resolvedBatchIds
  const resolvedBatchIds = options.importBatchIds
    ? options.importBatchIds
    : options.importBatchId
      ? [options.importBatchId]
      : (() => { throw new Error('importBatchId or importBatchIds is required') })()

  // Convert to DB types
  const dbSources = sources.map((s) => s.toUpperCase()) as Source[]
  const filterMode = filterProfile.mode.toUpperCase() as FilterMode

  // Build category filter
  const categoryCondition =
    filterMode === 'INCLUDE'
      ? { in: filterProfile.categories }
      : { notIn: filterProfile.categories }

  // Load eligible atoms with their labels (across all batches)
  // Only role=USER atoms are included in bundles (SPEC §9.1)
  const rawAtoms = await prisma.messageAtom.findMany({
    where: {
      importBatchId: { in: resolvedBatchIds },
      source: { in: dbSources },
      role: 'USER',
      dayDate: new Date(dayDate),
      messageLabels: {
        some: {
          model: labelSpec.model,
          promptVersionId: labelSpec.promptVersionId,
          category: categoryCondition,
        },
      },
    },
    select: {
      id: true,
      atomStableId: true,
      source: true,
      timestampUtc: true,
      role: true,
      text: true,
    },
    orderBy: [
      { source: 'asc' },
      { timestampUtc: 'asc' },
      { role: 'asc' },
      { atomStableId: 'asc' },
    ],
  })

  // Cross-batch dedup: keep first occurrence per atomStableId (already in canonical sort order)
  const seen = new Set<string>()
  const atoms = rawAtoms.filter((a) => {
    if (seen.has(a.atomStableId)) return false
    seen.add(a.atomStableId)
    return true
  })

  if (atoms.length === 0) {
    // Return empty bundle
    const emptyBundle = ''
    return {
      bundleText: emptyBundle,
      bundleHash: computeBundleHash(emptyBundle),
      bundleContextHash: computeBundleContextHash(resolvedBatchIds, dayDate, sources, filterProfile, labelSpec),
      atomCount: 0,
      atomIds: [],
      atoms: [],
    }
  }

  // Group by source for rendering
  const bySource = new Map<string, typeof atoms>()
  for (const atom of atoms) {
    const sourceKey = atom.source.toLowerCase()
    if (!bySource.has(sourceKey)) {
      bySource.set(sourceKey, [])
    }
    bySource.get(sourceKey)!.push(atom)
  }

  // Render bundle text
  const parts: string[] = []
  const sortedSources = Array.from(bySource.keys()).sort()

  for (const source of sortedSources) {
    const sourceAtoms = bySource.get(source)!
    parts.push(`# SOURCE: ${source}`)

    for (const atom of sourceAtoms) {
      const timestamp = toCanonicalTimestamp(atom.timestampUtc)
      const role = atom.role.toLowerCase()
      parts.push(`[${timestamp}] ${role}: ${atom.text}`)
    }

    parts.push('') // Blank line between sources
  }

  // Remove trailing blank line
  while (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop()
  }

  const bundleText = parts.join('\n')

  return {
    bundleText,
    bundleHash: computeBundleHash(bundleText),
    bundleContextHash: computeBundleContextHash(resolvedBatchIds, dayDate, sources, filterProfile, labelSpec),
    atomCount: atoms.length,
    atomIds: atoms.map((a) => a.id),
    atoms: atoms.map((a) => ({
      id: a.id,
      atomStableId: a.atomStableId,
      source: a.source,
      timestampUtc: a.timestampUtc,
      role: a.role,
      text: a.text,
    })),
  }
}

/**
 * Computes bundleHash per spec 5.3:
 * sha256("bundle_v1|" + stableBundleText)
 */
function computeBundleHash(bundleText: string): string {
  return sha256(`bundle_v1|${bundleText}`)
}

/**
 * Computes bundleContextHash per spec 5.3:
 * sha256("bundle_ctx_v1|" + importBatchIdsCsv + "|" + dayDate + "|" + sourcesCsv + "|" + filterProfileSnapshotJson + "|" + labelSpecJson)
 *
 * For single-batch, sorted join of [id] === id, so hash is backward compatible.
 */
function computeBundleContextHash(
  importBatchIds: string[],
  dayDate: string,
  sources: string[],
  filterProfile: { mode: string; categories: string[] },
  labelSpec: { model: string; promptVersionId: string }
): string {
  const importBatchIdsCsv = importBatchIds.slice().sort().join(',')
  const sourcesCsv = sources.slice().sort().join(',')
  const filterProfileJson = JSON.stringify(filterProfile)
  const labelSpecJson = JSON.stringify(labelSpec)

  return sha256(
    `bundle_ctx_v1|${importBatchIdsCsv}|${dayDate}|${sourcesCsv}|${filterProfileJson}|${labelSpecJson}`
  )
}

/**
 * Estimates token count for a bundle.
 * Uses a simple heuristic: ~4 characters per token.
 * This is conservative for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ----- Segmentation (segmenter_v1) -----

export interface Segment {
  /** Index of this segment (0-based) */
  index: number
  /** Stable segment ID per spec 9.2: sha256("segment_v1|" + bundleHash + "|" + segmentIndex) */
  segmentId: string
  /** The segment text (subset of atoms) */
  text: string
  /** Estimated tokens in this segment */
  estimatedTokens: number
  /** Atom IDs included in this segment */
  atomIds: string[]
}

export interface SegmentationResult {
  /** Original bundle hash (before segmentation) */
  bundleHash: string
  /** Total number of segments */
  segmentCount: number
  /** The segments */
  segments: Segment[]
  /** Whether segmentation was actually needed */
  wasSegmented: boolean
}

/**
 * An atom with its rendered text and metadata for segmentation.
 */
interface SegmentableAtom {
  id: string
  atomStableId: string
  source: string
  renderedLine: string
  estimatedTokens: number
}

/**
 * Deterministically segments a bundle that exceeds maxInputTokens.
 *
 * Segmentation algorithm (segmenter_v1):
 * 1. Parse the bundle into individual atom lines (preserving order)
 * 2. Greedily pack atoms into segments, respecting maxInputTokens
 * 3. Never split an atom across segments
 * 4. Generate stable segment IDs: sha256("segment_v1|" + bundleHash + "|" + segmentIndex)
 *
 * Determinism guarantee:
 * - Given the same atoms (in the same order) + same maxInputTokens → same segments
 * - Segment boundaries are determined purely by cumulative token count
 *
 * @param atoms - Array of atoms in deterministic order (from buildBundle)
 * @param bundleHash - Hash of the full bundle (for segment ID generation)
 * @param maxInputTokens - Maximum tokens per segment
 * @returns Segmentation result with all segments
 */
export function segmentBundle(
  atoms: Array<{
    id: string
    atomStableId: string
    source: string
    timestampUtc: Date
    role: string
    text: string
  }>,
  bundleHash: string,
  maxInputTokens: number
): SegmentationResult {
  // If no atoms, return empty result
  if (atoms.length === 0) {
    return {
      bundleHash,
      segmentCount: 0,
      segments: [],
      wasSegmented: false,
    }
  }

  // Render each atom to its line format and estimate tokens
  const segmentableAtoms: SegmentableAtom[] = atoms.map((atom) => {
    const timestamp = toCanonicalTimestamp(atom.timestampUtc)
    const role = atom.role.toLowerCase()
    const renderedLine = `[${timestamp}] ${role}: ${atom.text}`
    return {
      id: atom.id,
      atomStableId: atom.atomStableId,
      source: atom.source.toLowerCase(),
      renderedLine,
      estimatedTokens: estimateTokens(renderedLine),
    }
  })

  // Calculate total tokens
  const totalTokens = segmentableAtoms.reduce((sum, a) => sum + a.estimatedTokens, 0)

  // If within budget, return single segment (no segmentation needed)
  if (totalTokens <= maxInputTokens) {
    const fullText = renderSegmentText(segmentableAtoms)
    return {
      bundleHash,
      segmentCount: 1,
      segments: [
        {
          index: 0,
          segmentId: computeSegmentId(bundleHash, 0),
          text: fullText,
          estimatedTokens: totalTokens,
          atomIds: segmentableAtoms.map((a) => a.id),
        },
      ],
      wasSegmented: false,
    }
  }

  // Greedy segmentation: pack atoms into segments
  const segments: Segment[] = []
  let currentSegmentAtoms: SegmentableAtom[] = []
  let currentSegmentTokens = 0

  // Account for source header overhead (~20 tokens per unique source)
  const SOURCE_HEADER_OVERHEAD = 20

  for (const atom of segmentableAtoms) {
    // Check if adding a source header is needed
    const needsSourceHeader =
      currentSegmentAtoms.length === 0 ||
      currentSegmentAtoms[currentSegmentAtoms.length - 1].source !== atom.source
    const headerOverhead = needsSourceHeader ? SOURCE_HEADER_OVERHEAD : 0

    const atomTokensWithOverhead = atom.estimatedTokens + headerOverhead

    // If this atom would exceed budget and we have atoms, start new segment
    if (
      currentSegmentTokens + atomTokensWithOverhead > maxInputTokens &&
      currentSegmentAtoms.length > 0
    ) {
      // Flush current segment
      segments.push(createSegment(currentSegmentAtoms, bundleHash, segments.length))
      currentSegmentAtoms = []
      currentSegmentTokens = 0
    }

    // Add atom to current segment
    currentSegmentAtoms.push(atom)
    currentSegmentTokens += atomTokensWithOverhead
  }

  // Flush final segment
  if (currentSegmentAtoms.length > 0) {
    segments.push(createSegment(currentSegmentAtoms, bundleHash, segments.length))
  }

  return {
    bundleHash,
    segmentCount: segments.length,
    segments,
    wasSegmented: segments.length > 1,
  }
}

/**
 * Creates a segment from a list of atoms.
 */
function createSegment(
  atoms: SegmentableAtom[],
  bundleHash: string,
  index: number
): Segment {
  const text = renderSegmentText(atoms)
  return {
    index,
    segmentId: computeSegmentId(bundleHash, index),
    text,
    estimatedTokens: estimateTokens(text),
    atomIds: atoms.map((a) => a.id),
  }
}

/**
 * Renders a segment's text from atoms, grouping by source.
 */
function renderSegmentText(atoms: SegmentableAtom[]): string {
  if (atoms.length === 0) return ''

  const parts: string[] = []
  let currentSource: string | null = null

  for (const atom of atoms) {
    if (atom.source !== currentSource) {
      if (currentSource !== null) {
        parts.push('') // Blank line between sources
      }
      parts.push(`# SOURCE: ${atom.source}`)
      currentSource = atom.source
    }
    parts.push(atom.renderedLine)
  }

  return parts.join('\n')
}

/**
 * Computes stable segment ID per spec 9.2:
 * sha256("segment_v1|" + bundleHash + "|" + segmentIndex)
 */
function computeSegmentId(bundleHash: string, segmentIndex: number): string {
  return sha256(`segment_v1|${bundleHash}|${segmentIndex}`)
}
