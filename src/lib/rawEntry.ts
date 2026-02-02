/**
 * RawEntry utilities
 *
 * Spec reference: Section 6.5
 *
 * Construction (required):
 * - A RawEntry is created for each (importBatchId, source, dayDate)
 * - contentText is a deterministic rendering of all MessageAtoms for that day/source
 *   WITHOUT filtering
 * - Sort by: timestampUtc ASC, then role ASC (user before assistant), then atomStableId ASC
 * - Render lines as: [<timestampUtcISO>] <role>: <text>
 * - contentHash = sha256(contentText)
 */

import { sha256 } from './hash'
import { toCanonicalTimestamp } from './timestamp'

export interface RawEntryAtom {
  atomStableId: string
  timestampUtc: Date
  role: string // "user" | "assistant"
  text: string
}

/**
 * Sorts atoms deterministically per spec 6.5:
 * - timestampUtc ASC
 * - role ASC (user before assistant)
 * - atomStableId ASC (tie-breaker)
 */
function sortAtoms(atoms: RawEntryAtom[]): RawEntryAtom[] {
  return [...atoms].sort((a, b) => {
    // Primary: timestampUtc ASC
    const timeDiff = a.timestampUtc.getTime() - b.timestampUtc.getTime()
    if (timeDiff !== 0) return timeDiff

    // Secondary: role ASC (user before assistant per SPEC 6.5)
    // Note: 'user' > 'assistant' alphabetically, so we reverse the comparison
    const roleOrder = { user: 0, assistant: 1 } as const
    const roleDiff = (roleOrder[a.role as keyof typeof roleOrder] ?? 2) - (roleOrder[b.role as keyof typeof roleOrder] ?? 2)
    if (roleDiff !== 0) return roleDiff

    // Tertiary: atomStableId ASC
    return a.atomStableId.localeCompare(b.atomStableId)
  })
}

/**
 * Builds the contentText for a RawEntry from its atoms.
 *
 * @param atoms - MessageAtoms for this (source, dayDate)
 * @returns Deterministic content text
 */
export function buildRawEntryContent(atoms: RawEntryAtom[]): string {
  const sorted = sortAtoms(atoms)

  const lines = sorted.map((atom) => {
    const timestamp = toCanonicalTimestamp(atom.timestampUtc)
    return `[${timestamp}] ${atom.role}: ${atom.text}`
  })

  return lines.join('\n')
}

/**
 * Computes the content hash for RawEntry content.
 *
 * @param contentText - The raw entry content text
 * @returns SHA-256 hash as hex string
 */
export function computeRawEntryHash(contentText: string): string {
  return sha256(contentText)
}
