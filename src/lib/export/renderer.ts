/**
 * Export renderer
 *
 * Pure function that converts ExportInput into an in-memory file tree.
 * No DB, no filesystem I/O, no side effects.
 *
 * Spec reference: §14 (Git Export), §14.3 (Byte-stable rendering rules)
 */

import { sha256 } from '../hash'
import { EXPORT_FORMAT_VERSION, EXPORT_FORMAT_VERSION_V2, renderFrontmatter, renderJson } from './helpers'
import type { ExportInput, ExportDay, ExportAtom, ExportBatch, ExportTree, TopicData, ManifestTopicEntry } from './types'
import { groupAtomsByTopic, renderTopicIndex, renderTopicPage, TOPIC_VERSION } from './topics'
import { computeChangelog, renderChangelog } from './changelog'

/** Number of days shown in the "Recent" section when timeline has >14 entries */
const TIMELINE_RECENT_COUNT = 14

/**
 * Pure renderer: converts export input to a file tree.
 *
 * Returns a Map<relative_path, file_content_string>.
 * All paths use forward slashes. All content is UTF-8 with LF endings
 * and a trailing newline.
 */
export function renderExportTree(input: ExportInput): ExportTree {
  const tree: ExportTree = new Map()
  const isV2 = input.topicVersion !== undefined

  // 1. Static README
  tree.set('README.md', isV2 ? renderReadmeV2() : renderReadme())

  // 2. Timeline navigation index
  tree.set('views/timeline.md', renderTimeline(input.days))

  // 3. Per-day view files
  for (const day of input.days) {
    tree.set(`views/${day.dayDate}.md`, renderViewFile(day, input.run.id, input.run.model))
  }

  // 4–5. Atoms + sources (private tier only; public omits raw text)
  const tier = input.privacyTier ?? 'private'
  if (tier === 'private') {
    // 4. Per-day atom files (when atoms data is present)
    for (const day of input.days) {
      if (day.atoms !== undefined) {
        tree.set(`atoms/${day.dayDate}.md`, renderAtomsFile(day.atoms))
      }
    }

    // 5. Per-batch source metadata files
    const slugMap = generateSourceSlugs(input.batches)
    for (const batch of input.batches) {
      const slug = slugMap.get(batch.id)!
      tree.set(`sources/${slug}.md`, renderSourceFile(batch))
    }
  }

  // 6. V2: Topic pages + optional changelog (§14.10–§14.14)
  let topics: TopicData[] | undefined
  if (isV2) {
    topics = groupAtomsByTopic(input.days)

    // topics/INDEX.md + per-topic pages
    tree.set('topics/INDEX.md', renderTopicIndex(topics))
    for (const topic of topics) {
      tree.set(`topics/${topic.topicId}.md`, renderTopicPage(topic))
    }

    // changelog.md (only when previousManifest supplied)
    if (input.previousManifest) {
      const changelog = computeChangelog(topics, input.previousManifest)
      tree.set(
        'changelog.md',
        renderChangelog(changelog, input.exportedAt, input.previousManifest.exportedAt, input.topicVersion!),
      )
    }
  }

  // 7. Manifest (computed last — needs hashes of all other files)
  tree.set('.journal-meta/manifest.json', isV2
    ? renderManifestV2(input, tree, topics!)
    : renderManifest(input, tree))

  return tree
}

/**
 * Static README — format tour only.
 * Contains NO volatile data. Changes only when EXPORT_FORMAT_VERSION changes.
 */
function renderReadme(): string {
  return `# Journal Distiller Export

Format: ${EXPORT_FORMAT_VERSION}

## Directory layout

    views/              Daily journal entries
      timeline.md       Navigation index (newest first)
      YYYY-MM-DD.md     Individual day entries
    .journal-meta/      Export metadata
      manifest.json     File hashes, run info, batch details

## Browsing

Start with [views/timeline.md](views/timeline.md) for a chronological overview.
Open any views/YYYY-MM-DD.md file to read that day's entry.
See .journal-meta/manifest.json for full export metadata.
`
}

/**
 * Deterministic navigation index, newest-first.
 *
 * When ≤14 days: flat list under # Timeline
 * When >14 days: ## Recent (latest 14) + ## All entries (all)
 *
 * No frontmatter, no timestamps, no exportedAt.
 * Ordering: reverse lexicographic on dayDate string.
 */
function renderTimeline(days: ExportDay[]): string {
  const reversed = [...days].reverse()
  const parts: string[] = ['# Timeline', '']

  if (reversed.length > TIMELINE_RECENT_COUNT) {
    parts.push('## Recent', '')
    for (const day of reversed.slice(0, TIMELINE_RECENT_COUNT)) {
      parts.push(`- [${day.dayDate}](${day.dayDate}.md)`)
    }
    parts.push('', '## All entries', '')
  }

  for (const day of reversed) {
    parts.push(`- [${day.dayDate}](${day.dayDate}.md)`)
  }

  parts.push('')
  return parts.join('\n')
}

/**
 * Per-day view file with YAML frontmatter and output body.
 *
 * Frontmatter field order (fixed, array-of-tuples):
 * 1. date, 2. model, 3. runId, 4. createdAt,
 * 5. bundleHash, 6. bundleContextHash, 7. segmented, 8. segmentCount (if segmented)
 */
function renderViewFile(day: ExportDay, runId: string, model: string): string {
  const fields: Array<[string, string | number | boolean]> = [
    ['date', day.dayDate],
    ['model', model],
    ['runId', runId],
    ['createdAt', day.createdAt],
    ['bundleHash', day.bundleHash],
    ['bundleContextHash', day.bundleContextHash],
    ['segmented', day.segmented],
  ]

  if (day.segmented && day.segmentCount !== undefined) {
    fields.push(['segmentCount', day.segmentCount])
  }

  const frontmatter = renderFrontmatter(fields)
  return `${frontmatter}\n\n${day.outputText}\n`
}

/**
 * Per-day atoms file in §9.1 bundle format (user-role only).
 *
 * Groups atoms by source, renders as:
 *   # SOURCE: <source>
 *   [<timestampUtc>] user: <text>
 *
 * Atoms must already be sorted in §9.1 order (source ASC, timestampUtc ASC,
 * atomStableId ASC). An empty atom list produces a single trailing newline.
 */
function renderAtomsFile(atoms: ExportAtom[]): string {
  if (atoms.length === 0) return '\n'

  const parts: string[] = []
  let currentSource: string | null = null

  for (const atom of atoms) {
    if (atom.source !== currentSource) {
      if (currentSource !== null) parts.push('')
      parts.push(`# SOURCE: ${atom.source}`)
      currentSource = atom.source
    }
    parts.push(`[${atom.timestampUtc}] user: ${atom.text}`)
  }

  parts.push('')
  return parts.join('\n')
}

/**
 * Per-batch source metadata file.
 * YAML frontmatter with batch-level fields, no body.
 */
function renderSourceFile(batch: ExportBatch): string {
  const fields: Array<[string, string]> = [
    ['batchId', batch.id],
    ['source', batch.source],
    ['originalFilename', batch.originalFilename],
    ['timezone', batch.timezone],
  ]
  return `${renderFrontmatter(fields)}\n`
}

/**
 * Generates deterministic slugs for source files.
 *
 * Slug = `{source}-{filename_without_extension}`, sanitized to lowercase
 * alphanumeric + hyphens. Batches sorted by ID for deterministic ordering.
 * Collisions get `-2`, `-3` suffixes.
 */
export function generateSourceSlugs(batches: ExportBatch[]): Map<string, string> {
  const sorted = [...batches].sort((a, b) => a.id.localeCompare(b.id))
  const slugMap = new Map<string, string>()
  const usedSlugs = new Map<string, number>()

  for (const batch of sorted) {
    const baseSlug = generateBaseSlug(batch)
    const count = usedSlugs.get(baseSlug) ?? 0
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`
    usedSlugs.set(baseSlug, count + 1)
    slugMap.set(batch.id, slug)
  }

  return slugMap
}

function generateBaseSlug(batch: ExportBatch): string {
  const nameWithoutExt = batch.originalFilename.replace(/\.[^.]+$/, '')
  const sanitized = nameWithoutExt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${batch.source}-${sanitized}`
}

/**
 * Machine-readable manifest with file hashes (v1).
 * exportedAt is the ONLY volatile field.
 * All keys sorted alphabetically via renderJson().
 */
function renderManifest(input: ExportInput, tree: ExportTree): string {
  const files = computeFileHashes(tree)

  const manifest = {
    batches: input.batches.map((b) => ({
      id: b.id,
      originalFilename: b.originalFilename,
      source: b.source,
      timezone: b.timezone,
    })),
    dateRange: {
      end: input.run.endDate,
      start: input.run.startDate,
    },
    exportedAt: input.exportedAt,
    files,
    formatVersion: EXPORT_FORMAT_VERSION,
    run: {
      endDate: input.run.endDate,
      filterProfile: {
        categories: input.run.filterProfile.categories,
        mode: input.run.filterProfile.mode,
        name: input.run.filterProfile.name,
      },
      id: input.run.id,
      model: input.run.model,
      sources: input.run.sources,
      startDate: input.run.startDate,
      timezone: input.run.timezone,
    },
  }

  return renderJson(manifest as unknown as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// V2 additions (§14.10, §14.15)
// ---------------------------------------------------------------------------

/**
 * V2 README — updated directory layout showing topics/ and changelog.md.
 */
function renderReadmeV2(): string {
  return `# Journal Distiller Export

Format: ${EXPORT_FORMAT_VERSION_V2}

## Directory layout

    views/              Daily journal entries
      timeline.md       Navigation index (newest first)
      YYYY-MM-DD.md     Individual day entries
    topics/             Topic-based navigation
      INDEX.md          Topic overview table
      <topicId>.md      Per-topic day listing
    changelog.md        Changes since previous export (when available)
    .journal-meta/      Export metadata
      manifest.json     File hashes, run info, topic data

## Browsing

Start with [views/timeline.md](views/timeline.md) for a chronological overview.
Open any views/YYYY-MM-DD.md file to read that day's entry.
See [topics/INDEX.md](topics/INDEX.md) for topic-based navigation.
See .journal-meta/manifest.json for full export metadata.
`
}

/**
 * V2 manifest — adds topics, topicVersion, changelog keys (§14.15).
 */
function renderManifestV2(input: ExportInput, tree: ExportTree, topics: TopicData[]): string {
  const files = computeFileHashes(tree)

  // Build topics manifest entries keyed by topicId
  const topicsManifest: Record<string, ManifestTopicEntry> = {}
  for (const topic of topics) {
    topicsManifest[topic.topicId] = {
      atomCount: topic.atomCount,
      category: topic.category,
      dayCount: topic.dayCount,
      days: topic.days.map((d) => d.dayDate), // already sorted ascending
      displayName: topic.displayName,
    }
  }

  // Changelog summary: null when no previousManifest, otherwise { previousExportedAt, changeCount }
  let changelogSummary: { previousExportedAt: string; changeCount: number } | null = null
  if (input.previousManifest) {
    const changelog = computeChangelog(topics, input.previousManifest)
    changelogSummary = {
      previousExportedAt: input.previousManifest.exportedAt,
      changeCount: changelog.changeCount,
    }
  }

  const manifest = {
    batches: input.batches.map((b) => ({
      id: b.id,
      originalFilename: b.originalFilename,
      source: b.source,
      timezone: b.timezone,
    })),
    changelog: changelogSummary,
    dateRange: {
      end: input.run.endDate,
      start: input.run.startDate,
    },
    exportedAt: input.exportedAt,
    files,
    formatVersion: EXPORT_FORMAT_VERSION_V2,
    run: {
      endDate: input.run.endDate,
      filterProfile: {
        categories: input.run.filterProfile.categories,
        mode: input.run.filterProfile.mode,
        name: input.run.filterProfile.name,
      },
      id: input.run.id,
      model: input.run.model,
      sources: input.run.sources,
      startDate: input.run.startDate,
      timezone: input.run.timezone,
    },
    topics: topicsManifest,
    topicVersion: input.topicVersion,
  }

  return renderJson(manifest as unknown as Record<string, unknown>)
}

/** Compute sha256 for every file already in the tree (everything except manifest itself). */
function computeFileHashes(tree: ExportTree): Record<string, { sha256: string }> {
  const files: Record<string, { sha256: string }> = {}
  for (const [path, content] of tree) {
    files[path] = { sha256: sha256(content) }
  }
  return files
}
