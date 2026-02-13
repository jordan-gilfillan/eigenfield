/**
 * Export renderer
 *
 * Pure function that converts ExportInput into an in-memory file tree.
 * No DB, no filesystem I/O, no side effects.
 *
 * Spec reference: §14 (Git Export), §14.3 (Byte-stable rendering rules)
 */

import { sha256 } from '../hash'
import { EXPORT_FORMAT_VERSION, renderFrontmatter, renderJson } from './helpers'
import type { ExportInput, ExportDay, ExportTree } from './types'

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

  // 1. Static README
  tree.set('README.md', renderReadme())

  // 2. Timeline navigation index
  tree.set('views/timeline.md', renderTimeline(input.days))

  // 3. Per-day view files
  for (const day of input.days) {
    tree.set(`views/${day.dayDate}.md`, renderViewFile(day, input.run.id, input.run.model))
  }

  // 4. Manifest (computed last — needs hashes of all other files)
  tree.set('.journal-meta/manifest.json', renderManifest(input, tree))

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
 * Machine-readable manifest with file hashes.
 * exportedAt is the ONLY volatile field.
 * All keys sorted alphabetically via renderJson().
 */
function renderManifest(input: ExportInput, tree: ExportTree): string {
  // Compute sha256 for every file already in the tree (everything except manifest itself)
  const files: Record<string, { sha256: string }> = {}
  for (const [path, content] of tree) {
    files[path] = { sha256: sha256(content) }
  }

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
