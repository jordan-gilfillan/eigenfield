/**
 * Export v2 — changelog computation and rendering
 *
 * Compares current topic metadata against a previous export's manifest
 * to produce a "diff of thinking" changelog.
 *
 * Spec reference: §14.14
 */

import type {
  ChangelogChangedTopic,
  ChangelogData,
  ChangelogNewTopic,
  ChangelogRemovedTopic,
  PreviousManifest,
  TopicData,
} from './types'
import { categoryDisplayName } from './topics'
import { renderFrontmatter } from './helpers'

// ---------------------------------------------------------------------------
// Changelog computation (§14.14)
// ---------------------------------------------------------------------------

/**
 * Computes the changelog between current topics and a previous manifest.
 *
 * Change detection algorithm (§14.14):
 * - newTopics     = current − previous
 * - removedTopics = previous − current
 * - changedTopics = intersection where days set or atomCount differ
 */
export function computeChangelog(
  currentTopics: TopicData[],
  previousManifest: PreviousManifest,
): ChangelogData {
  const currentMap = new Map(currentTopics.map((t) => [t.topicId, t]))
  const previousTopicIds = new Set(Object.keys(previousManifest.topics))
  const currentTopicIds = new Set(currentMap.keys())

  // New topics: in current but not in previous
  const newTopics: ChangelogNewTopic[] = []
  for (const id of currentTopicIds) {
    if (!previousTopicIds.has(id)) {
      const t = currentMap.get(id)!
      newTopics.push({
        topicId: t.topicId,
        displayName: t.displayName,
        dayCount: t.dayCount,
        atomCount: t.atomCount,
      })
    }
  }
  newTopics.sort((a, b) => a.displayName.localeCompare(b.displayName))

  // Removed topics: in previous but not in current
  const removedTopics: ChangelogRemovedTopic[] = []
  for (const id of previousTopicIds) {
    if (!currentTopicIds.has(id)) {
      const prev = previousManifest.topics[id]
      removedTopics.push({
        topicId: id,
        displayName: prev.displayName,
        previousDayCount: prev.dayCount,
        previousAtomCount: prev.atomCount,
      })
    }
  }
  removedTopics.sort((a, b) => a.displayName.localeCompare(b.displayName))

  // Changed topics: in both, but days set or atomCount differ
  const changedTopics: ChangelogChangedTopic[] = []
  for (const id of currentTopicIds) {
    if (!previousTopicIds.has(id)) continue
    const curr = currentMap.get(id)!
    const prev = previousManifest.topics[id]

    const currDays = new Set(curr.days.map((d) => d.dayDate))
    const prevDays = new Set(prev.days)

    const daysAdded = [...currDays].filter((d) => !prevDays.has(d)).sort()
    const daysRemoved = [...prevDays].filter((d) => !currDays.has(d)).sort()

    if (daysAdded.length > 0 || daysRemoved.length > 0 || curr.atomCount !== prev.atomCount) {
      changedTopics.push({
        topicId: id,
        displayName: curr.displayName,
        daysAdded,
        daysRemoved,
        previousAtomCount: prev.atomCount,
        currentAtomCount: curr.atomCount,
      })
    }
  }
  changedTopics.sort((a, b) => a.displayName.localeCompare(b.displayName))

  return {
    newTopics,
    removedTopics,
    changedTopics,
    changeCount: newTopics.length + removedTopics.length + changedTopics.length,
  }
}

// ---------------------------------------------------------------------------
// Changelog rendering (§14.14)
// ---------------------------------------------------------------------------

/**
 * Renders changelog.md content from computed changelog data.
 *
 * YAML frontmatter: exportedAt, previousExportedAt, topicVersion, changeCount
 * Body sections: New topics, Removed topics, Changed topics (empty sections omitted)
 */
export function renderChangelog(
  changelog: ChangelogData,
  exportedAt: string,
  previousExportedAt: string,
  topicVersion: string,
): string {
  const fields: Array<[string, string | number | boolean]> = [
    ['exportedAt', exportedAt],
    ['previousExportedAt', previousExportedAt],
    ['topicVersion', topicVersion],
    ['changeCount', changelog.changeCount],
  ]

  const parts: string[] = [renderFrontmatter(fields)]

  // New topics section
  if (changelog.newTopics.length > 0) {
    parts.push('', '## New topics', '')
    for (const t of changelog.newTopics) {
      parts.push(`- **${t.displayName}** (\`${t.topicId}\`) — ${t.dayCount} days, ${t.atomCount} atoms`)
    }
  }

  // Removed topics section
  if (changelog.removedTopics.length > 0) {
    parts.push('', '## Removed topics', '')
    for (const t of changelog.removedTopics) {
      parts.push(`- **${t.displayName}** (\`${t.topicId}\`) — was ${t.previousDayCount} days, ${t.previousAtomCount} atoms`)
    }
  }

  // Changed topics section
  if (changelog.changedTopics.length > 0) {
    parts.push('', '## Changed topics', '')
    for (const t of changelog.changedTopics) {
      parts.push(`### ${t.displayName} (\`${t.topicId}\`)`)
      parts.push(`- Days added: ${t.daysAdded.length > 0 ? t.daysAdded.join(', ') : '(none)'}`)
      parts.push(`- Days removed: ${t.daysRemoved.length > 0 ? t.daysRemoved.join(', ') : '(none)'}`)
      const delta = t.currentAtomCount - t.previousAtomCount
      const sign = delta >= 0 ? '+' : ''
      parts.push(`- Atom count: ${t.previousAtomCount} → ${t.currentAtomCount} (${sign}${delta})`)
    }
  }

  parts.push('')
  return parts.join('\n')
}
