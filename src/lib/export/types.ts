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

export interface ExportAtom {
  source: string             // lowercase
  timestampUtc: string       // ISO 8601 (canonical, §5.2)
  text: string
  atomStableId: string       // for deterministic sort tie-breaking
  category?: string          // lowercase categoryApi from MessageLabel (§14.11)
}

export interface ExportDay {
  dayDate: string            // YYYY-MM-DD
  outputText: string         // markdown (from Output.outputText)
  createdAt: string          // ISO 8601 (from Output.createdAt, immutable)
  bundleHash: string         // sha256 of input bundle text
  bundleContextHash: string  // sha256 of config context
  segmented: boolean
  segmentCount?: number      // present only when segmented: true
  atoms?: ExportAtom[]       // user-role atoms in §9.1 order (for atoms/ export)
}

export type PrivacyTier = 'public' | 'private'

// ---------------------------------------------------------------------------
// v2 topic types (§14.11–§14.13)
// ---------------------------------------------------------------------------

/** Per-day atom count for a single topic */
export interface TopicDayEntry {
  dayDate: string            // YYYY-MM-DD
  atomCount: number          // atoms in this category on this day
}

/** Computed topic data for rendering topic pages + INDEX */
export interface TopicData {
  topicId: string            // = categoryApi in topic_v1 (§14.11)
  category: string           // categoryApi value (lowercase)
  displayName: string        // Title Case (§14.12)
  atomCount: number          // total atoms for this topic
  dayCount: number           // distinct days with ≥1 atom
  dateRange: { start: string; end: string }  // YYYY-MM-DD
  days: TopicDayEntry[]      // sorted ascending by dayDate
}

// ---------------------------------------------------------------------------
// v2 changelog types (§14.14)
// ---------------------------------------------------------------------------

export interface ChangelogNewTopic {
  topicId: string
  displayName: string
  dayCount: number
  atomCount: number
}

export interface ChangelogRemovedTopic {
  topicId: string
  displayName: string
  previousDayCount: number
  previousAtomCount: number
}

export interface ChangelogChangedTopic {
  topicId: string
  displayName: string
  daysAdded: string[]        // ascending date order
  daysRemoved: string[]      // ascending date order
  previousAtomCount: number
  currentAtomCount: number
}

export interface ChangelogData {
  newTopics: ChangelogNewTopic[]
  removedTopics: ChangelogRemovedTopic[]
  changedTopics: ChangelogChangedTopic[]
  changeCount: number        // total entries across all 3 sections
}

// ---------------------------------------------------------------------------
// v2 manifest types (§14.15)
// ---------------------------------------------------------------------------

/** Topic entry in manifest.json — keys alpha-sorted per §14.3 */
export interface ManifestTopicEntry {
  atomCount: number
  category: string
  dayCount: number
  days: string[]             // YYYY-MM-DD, sorted ascending
  displayName: string
}

/** Changelog summary in manifest.json */
export interface ManifestChangelog {
  changeCount: number
  previousExportedAt: string
}

/** Previous export's manifest — supplied by caller for changelog (§14.14) */
export interface PreviousManifest {
  exportedAt: string
  topics: Record<string, ManifestTopicEntry>
  topicVersion: string
}

// ---------------------------------------------------------------------------
// ExportInput (v1 + v2 optional fields)
// ---------------------------------------------------------------------------

export interface ExportInput {
  run: ExportRun
  batches: ExportBatch[]
  days: ExportDay[]          // ordered by dayDate ASC
  exportedAt: string         // ISO 8601, caller-supplied for determinism
  privacyTier?: PrivacyTier  // default 'private'; public omits atoms/ and sources/
  previousManifest?: PreviousManifest  // for changelog (§14.14); omit → no changelog
  topicVersion?: string      // default undefined (v1 mode); set to "topic_v1" for v2
}

/** Relative path → file content (UTF-8 string, LF endings, trailing newline) */
export type ExportTree = Map<string, string>
