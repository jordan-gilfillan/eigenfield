/**
 * Bundle hash utilities
 *
 * Spec reference: Section 5.3
 *
 * Two hashes are used:
 * - bundleHash: sha256("bundle_v1|" + stableBundleText)
 *   Hashes the exact bytes of the deterministic bundle text (what the model saw)
 *
 * - bundleContextHash: sha256(
 *     "bundle_ctx_v1|" + importBatchId + "|" + dayDate + "|" + sourcesCsv + "|" +
 *     filterProfileSnapshotJson + "|" + labelSpecJson
 *   )
 *   Hashes the inputs that produced the bundle (why this bundle exists)
 */

import { sha256 } from './hash'

/**
 * Computes the bundle hash from the stable bundle text.
 *
 * @param stableBundleText - The deterministic bundle text (per spec 9.1)
 * @returns SHA-256 hash as hex string
 */
export function computeBundleHash(stableBundleText: string): string {
  return sha256(`bundle_v1|${stableBundleText}`)
}

export interface BundleContextParams {
  importBatchId: string
  dayDate: string // YYYY-MM-DD
  sources: string[] // lowercase source names
  filterProfileSnapshot: {
    name: string
    mode: string // "include" | "exclude"
    categories: string[] // lowercase category names
  }
  labelSpec: {
    model: string
    promptVersionId: string
  }
}

/**
 * Computes the bundle context hash from the inputs that produced the bundle.
 *
 * @param params - The context parameters
 * @returns SHA-256 hash as hex string
 */
export function computeBundleContextHash(params: BundleContextParams): string {
  const { importBatchId, dayDate, sources, filterProfileSnapshot, labelSpec } =
    params

  // Sort sources for determinism
  const sourcesCsv = [...sources].sort().join(',')

  // Serialize snapshots as deterministic JSON (sorted keys)
  const filterProfileSnapshotJson = JSON.stringify(filterProfileSnapshot, Object.keys(filterProfileSnapshot).sort())
  const labelSpecJson = JSON.stringify(labelSpec, Object.keys(labelSpec).sort())

  const parts = [
    'bundle_ctx_v1',
    importBatchId,
    dayDate,
    sourcesCsv,
    filterProfileSnapshotJson,
    labelSpecJson,
  ]

  return sha256(parts.join('|'))
}
