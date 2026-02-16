/**
 * Export v2 — topic computation and rendering
 *
 * topic_v1: topics are 1:1 with Category enum values.
 * Each category with ≥1 atom produces one topic page.
 *
 * Spec reference: §14.11–§14.13
 */

import type { CategoryApi } from '../enums'
import type { ExportDay, TopicData, TopicDayEntry } from './types'
import { renderFrontmatter } from './helpers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOPIC_VERSION = 'topic_v1'

/** Hardcoded display name mapping (§14.12) */
export const CATEGORY_DISPLAY_NAMES: Record<CategoryApi, string> = {
  work: 'Work',
  learning: 'Learning',
  creative: 'Creative',
  mundane: 'Mundane',
  personal: 'Personal',
  other: 'Other',
  medical: 'Medical',
  mental_health: 'Mental Health',
  addiction_recovery: 'Addiction Recovery',
  intimacy: 'Intimacy',
  financial: 'Financial',
  legal: 'Legal',
  embarrassing: 'Embarrassing',
}

// ---------------------------------------------------------------------------
// Topic ID (§14.11)
// ---------------------------------------------------------------------------

/**
 * Computes topicId from a categoryApi value.
 *
 * In topic_v1, topicId IS the category name (lowercase).
 * This function exists as a seam for topic_v2 (hash-based IDs).
 */
export function computeTopicId(category: string): string {
  return category
}

/**
 * Returns the Title Case display name for a categoryApi value.
 * Falls back to the raw category string if not in the mapping.
 */
export function categoryDisplayName(category: string): string {
  return CATEGORY_DISPLAY_NAMES[category as CategoryApi] ?? category
}

// ---------------------------------------------------------------------------
// Topic grouping (§14.11)
// ---------------------------------------------------------------------------

/**
 * Groups category-annotated atoms into TopicData records.
 *
 * Atoms without a category are assigned to 'other'.
 * Returns topics sorted for INDEX rendering: atom count DESC, category ASC.
 */
export function groupAtomsByTopic(days: ExportDay[]): TopicData[] {
  // Accumulator: category → { dayDate → atomCount }
  const categoryDays = new Map<string, Map<string, number>>()

  for (const day of days) {
    if (!day.atoms) continue
    for (const atom of day.atoms) {
      const category = atom.category ?? 'other'
      let dayMap = categoryDays.get(category)
      if (!dayMap) {
        dayMap = new Map()
        categoryDays.set(category, dayMap)
      }
      dayMap.set(day.dayDate, (dayMap.get(day.dayDate) ?? 0) + 1)
    }
  }

  // Convert to TopicData[]
  const topics: TopicData[] = []
  for (const [category, dayMap] of categoryDays) {
    const topicId = computeTopicId(category)
    const displayName = categoryDisplayName(category)

    // Sort days ascending by dayDate
    const sortedDayDates = [...dayMap.keys()].sort()
    const topicDays: TopicDayEntry[] = sortedDayDates.map((d) => ({
      dayDate: d,
      atomCount: dayMap.get(d)!,
    }))

    const atomCount = topicDays.reduce((sum, d) => sum + d.atomCount, 0)

    topics.push({
      topicId,
      category,
      displayName,
      atomCount,
      dayCount: topicDays.length,
      dateRange: {
        start: sortedDayDates[0],
        end: sortedDayDates[sortedDayDates.length - 1],
      },
      days: topicDays,
    })
  }

  // Sort: atomCount DESC, then category ASC (tie-breaker)
  topics.sort((a, b) => {
    if (b.atomCount !== a.atomCount) return b.atomCount - a.atomCount
    return a.category.localeCompare(b.category)
  })

  return topics
}

// ---------------------------------------------------------------------------
// Topic page rendering (§14.12–§14.13)
// ---------------------------------------------------------------------------

/**
 * Renders topics/INDEX.md content (§14.12).
 *
 * Table rows sorted: atomCount DESC, category ASC (same as TopicData order).
 * No frontmatter, no timestamps.
 */
export function renderTopicIndex(topics: TopicData[]): string {
  const parts: string[] = [
    '# Topics',
    '',
    '| Topic | Category | Days | Atoms |',
    '|-------|----------|------|-------|',
  ]

  for (const topic of topics) {
    parts.push(
      `| [${topic.displayName}](${topic.topicId}.md) | ${topic.category} | ${topic.dayCount} | ${topic.atomCount} |`,
    )
  }

  parts.push('')
  return parts.join('\n')
}

/**
 * Renders a single topics/<topicId>.md page (§14.13).
 *
 * YAML frontmatter + day listing (newest-first).
 * Singular "atom" when count is 1.
 */
export function renderTopicPage(topic: TopicData): string {
  const fields: Array<[string, string | number | boolean]> = [
    ['topicId', topic.topicId],
    ['topicVersion', TOPIC_VERSION],
    ['category', topic.category],
    ['displayName', topic.displayName],
    ['atomCount', topic.atomCount],
    ['dayCount', topic.dayCount],
    ['dateRange', `${topic.dateRange.start} to ${topic.dateRange.end}`],
  ]

  const frontmatter = renderFrontmatter(fields)

  // Days listed newest-first (reverse of the ascending-sorted days array)
  const dayLines = [...topic.days].reverse().map((d) => {
    const label = d.atomCount === 1 ? 'atom' : 'atoms'
    return `- [${d.dayDate}](../views/${d.dayDate}.md) (${d.atomCount} ${label})`
  })

  const parts = [frontmatter, '', '## Days', '', ...dayLines, '']
  return parts.join('\n')
}
