/**
 * Export v2 — changelog computation and rendering
 *
 * Compares current topic metadata against a previous export's manifest
 * to produce a "diff of thinking" changelog.
 *
 * Spec reference: §14.14
 */

import type { ChangelogData, PreviousManifest, TopicData } from './types'

// ---------------------------------------------------------------------------
// Changelog computation (stub — implemented in EPIC-083c)
// ---------------------------------------------------------------------------

/**
 * Computes the changelog between current topics and a previous manifest.
 *
 * Change detection algorithm (§14.14):
 * - newTopics     = current − previous
 * - removedTopics = previous − current
 * - changedTopics = intersection where days or atomCount differ
 *
 * @throws Error — stub, not yet implemented
 */
export function computeChangelog(
  _currentTopics: TopicData[],
  _previousManifest: PreviousManifest,
): ChangelogData {
  throw new Error('computeChangelog not implemented — see EPIC-083c')
}

// ---------------------------------------------------------------------------
// Changelog rendering (stub — implemented in EPIC-083c)
// ---------------------------------------------------------------------------

/**
 * Renders changelog.md content from computed changelog data.
 *
 * YAML frontmatter: exportedAt, previousExportedAt, topicVersion, changeCount
 * Body sections: New topics, Removed topics, Changed topics (empty omitted)
 *
 * @throws Error — stub, not yet implemented
 */
export function renderChangelog(
  _changelog: ChangelogData,
  _exportedAt: string,
  _previousExportedAt: string,
  _topicVersion: string,
): string {
  throw new Error('renderChangelog not implemented — see EPIC-083c')
}
