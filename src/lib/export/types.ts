/**
 * Export type definitions
 *
 * Structured input for the pure export renderer.
 * The DB orchestrator (AUD-063) constructs ExportInput from Run+Job+Output+Batch records.
 *
 * Spec reference: §14 (Git Export)
 */

export interface ExportRun {
  id: string
  model: string
  startDate: string          // YYYY-MM-DD
  endDate: string            // YYYY-MM-DD
  sources: string[]          // lowercase
  timezone: string           // IANA
  filterProfile: {
    name: string
    mode: string             // 'include' | 'exclude'
    categories: string[]
  }
}

export interface ExportBatch {
  id: string
  source: string             // lowercase
  originalFilename: string
  timezone: string           // IANA
}

export interface ExportDay {
  dayDate: string            // YYYY-MM-DD
  outputText: string         // markdown (from Output.outputText)
  createdAt: string          // ISO 8601 (from Output.createdAt, immutable)
  bundleHash: string         // sha256 of input bundle text
  bundleContextHash: string  // sha256 of config context
  segmented: boolean
  segmentCount?: number      // present only when segmented: true
}

export interface ExportInput {
  run: ExportRun
  batches: ExportBatch[]
  days: ExportDay[]          // ordered by dayDate ASC
  exportedAt: string         // ISO 8601, caller-supplied for determinism
}

/** Relative path → file content (UTF-8 string, LF endings, trailing newline) */
export type ExportTree = Map<string, string>
