/**
 * Export v2 — topic computation and rendering
 *
 * topic_v1: topics are 1:1 with Category enum values.
 * Each category with ≥1 atom produces one topic page.
 *
 * Spec reference: §14.11–§14.13
 */

import type { CategoryApi } from '../enums'
import type { ExportDay, TopicData } from './types'

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
// Topic grouping (stub — implemented in EPIC-083c)
// ---------------------------------------------------------------------------

/**
 * Groups category-annotated atoms into TopicData records.
 *
 * Atoms without a category are assigned to 'other'.
 * Returns topics sorted for INDEX rendering: atom count DESC, category ASC.
 *
 * @throws Error — stub, not yet implemented
 */
export function groupAtomsByTopic(_days: ExportDay[]): TopicData[] {
  throw new Error('groupAtomsByTopic not implemented — see EPIC-083c')
}

// ---------------------------------------------------------------------------
// Topic page rendering (stubs — implemented in EPIC-083c)
// ---------------------------------------------------------------------------

/**
 * Renders topics/INDEX.md content.
 *
 * @throws Error — stub, not yet implemented
 */
export function renderTopicIndex(_topics: TopicData[]): string {
  throw new Error('renderTopicIndex not implemented — see EPIC-083c')
}

/**
 * Renders a single topics/<topicId>.md page.
 *
 * @throws Error — stub, not yet implemented
 */
export function renderTopicPage(_topic: TopicData): string {
  throw new Error('renderTopicPage not implemented — see EPIC-083c')
}
