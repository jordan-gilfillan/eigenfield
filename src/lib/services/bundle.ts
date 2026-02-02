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
  importBatchId: string
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
  const { importBatchId, dayDate, sources, labelSpec, filterProfile } = options

  // Convert to DB types
  const dbSources = sources.map((s) => s.toUpperCase()) as Source[]
  const filterMode = filterProfile.mode.toUpperCase() as FilterMode

  // Build category filter
  const categoryCondition =
    filterMode === 'INCLUDE'
      ? { in: filterProfile.categories }
      : { notIn: filterProfile.categories }

  // Load eligible atoms with their labels
  const atoms = await prisma.messageAtom.findMany({
    where: {
      importBatchId,
      source: { in: dbSources },
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

  if (atoms.length === 0) {
    // Return empty bundle
    const emptyBundle = ''
    return {
      bundleText: emptyBundle,
      bundleHash: computeBundleHash(emptyBundle),
      bundleContextHash: computeBundleContextHash(importBatchId, dayDate, sources, filterProfile, labelSpec),
      atomCount: 0,
      atomIds: [],
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
    bundleContextHash: computeBundleContextHash(importBatchId, dayDate, sources, filterProfile, labelSpec),
    atomCount: atoms.length,
    atomIds: atoms.map((a) => a.id),
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
 * sha256("bundle_ctx_v1|" + importBatchId + "|" + dayDate + "|" + sourcesCsv + "|" + filterProfileSnapshotJson + "|" + labelSpecJson)
 */
function computeBundleContextHash(
  importBatchId: string,
  dayDate: string,
  sources: string[],
  filterProfile: { mode: string; categories: string[] },
  labelSpec: { model: string; promptVersionId: string }
): string {
  const sourcesCsv = sources.slice().sort().join(',')
  const filterProfileJson = JSON.stringify(filterProfile)
  const labelSpecJson = JSON.stringify(labelSpec)

  return sha256(
    `bundle_ctx_v1|${importBatchId}|${dayDate}|${sourcesCsv}|${filterProfileJson}|${labelSpecJson}`
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
