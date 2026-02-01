/**
 * Stable ID generation
 *
 * Spec reference: Section 5.2
 *
 * atomStableId = sha256(
 *   "atom_v1|" + source + "|" + (sourceConversationId||"") + "|" +
 *   (sourceMessageId||"") + "|" + timestampUtcISO + "|" + role + "|" + textHash
 * )
 */

import { sha256 } from './hash'
import { normalizeText } from './normalize'
import { toCanonicalTimestamp } from './timestamp'

export interface AtomStableIdParams {
  source: string
  sourceConversationId?: string | null
  sourceMessageId?: string | null
  timestampUtc: Date
  role: string
  text: string
}

/**
 * Computes the stable ID for a MessageAtom.
 *
 * The stable ID is deterministic and does not depend on DB insertion order,
 * random UUIDs, or concurrency. It is stable across re-imports of the same file.
 *
 * @param params - The atom parameters
 * @returns SHA-256 hash as hex string
 */
export function computeAtomStableId(params: AtomStableIdParams): string {
  const {
    source,
    sourceConversationId,
    sourceMessageId,
    timestampUtc,
    role,
    text,
  } = params

  // Normalize and hash the text first
  const normalizedText = normalizeText(text)
  const textHash = sha256(normalizedText)

  // Build the stable ID input string
  const parts = [
    'atom_v1',
    source.toLowerCase(), // API uses lowercase
    sourceConversationId ?? '',
    sourceMessageId ?? '',
    toCanonicalTimestamp(timestampUtc),
    role.toLowerCase(), // API uses lowercase
    textHash,
  ]

  return sha256(parts.join('|'))
}

/**
 * Computes the text hash for a MessageAtom.
 *
 * @param text - The raw message text
 * @returns SHA-256 hash of normalized text as hex string
 */
export function computeTextHash(text: string): string {
  return sha256(normalizeText(text))
}
