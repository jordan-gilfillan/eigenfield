/**
 * Export v2 — topics module tests
 *
 * Tests for computeTopicId, categoryDisplayName, TOPIC_VERSION constant,
 * and stub function signatures.
 *
 * Spec reference: §14.11–§14.13
 */

import { describe, it, expect } from 'vitest'
import {
  computeTopicId,
  categoryDisplayName,
  CATEGORY_DISPLAY_NAMES,
  TOPIC_VERSION,
  groupAtomsByTopic,
  renderTopicIndex,
  renderTopicPage,
} from '../lib/export/topics'
import { CATEGORY_VALUES } from '../lib/enums'
import type { TopicData } from '../lib/export/types'

// ---------------------------------------------------------------------------
// TOPIC_VERSION constant
// ---------------------------------------------------------------------------

describe('TOPIC_VERSION', () => {
  it('is "topic_v1"', () => {
    expect(TOPIC_VERSION).toBe('topic_v1')
  })
})

// ---------------------------------------------------------------------------
// computeTopicId (§14.11)
// ---------------------------------------------------------------------------

describe('computeTopicId', () => {
  it('returns the category string unchanged (topic_v1 identity)', () => {
    expect(computeTopicId('work')).toBe('work')
    expect(computeTopicId('mental_health')).toBe('mental_health')
    expect(computeTopicId('addiction_recovery')).toBe('addiction_recovery')
  })

  it('is deterministic — same input always produces same output', () => {
    for (const category of CATEGORY_VALUES) {
      const id1 = computeTopicId(category)
      const id2 = computeTopicId(category)
      expect(id1).toBe(id2)
    }
  })

  it('produces unique IDs for all 13 categories', () => {
    const ids = CATEGORY_VALUES.map(computeTopicId)
    expect(new Set(ids).size).toBe(13)
  })

  it('produces lowercase IDs', () => {
    for (const category of CATEGORY_VALUES) {
      const id = computeTopicId(category)
      expect(id).toBe(id.toLowerCase())
    }
  })
})

// ---------------------------------------------------------------------------
// categoryDisplayName (§14.12)
// ---------------------------------------------------------------------------

describe('categoryDisplayName', () => {
  it('maps all 13 categories to Title Case display names', () => {
    expect(categoryDisplayName('work')).toBe('Work')
    expect(categoryDisplayName('learning')).toBe('Learning')
    expect(categoryDisplayName('creative')).toBe('Creative')
    expect(categoryDisplayName('mundane')).toBe('Mundane')
    expect(categoryDisplayName('personal')).toBe('Personal')
    expect(categoryDisplayName('other')).toBe('Other')
    expect(categoryDisplayName('medical')).toBe('Medical')
    expect(categoryDisplayName('mental_health')).toBe('Mental Health')
    expect(categoryDisplayName('addiction_recovery')).toBe('Addiction Recovery')
    expect(categoryDisplayName('intimacy')).toBe('Intimacy')
    expect(categoryDisplayName('financial')).toBe('Financial')
    expect(categoryDisplayName('legal')).toBe('Legal')
    expect(categoryDisplayName('embarrassing')).toBe('Embarrassing')
  })

  it('covers every value in CATEGORY_VALUES', () => {
    for (const category of CATEGORY_VALUES) {
      const name = categoryDisplayName(category)
      expect(name).toBeTruthy()
      expect(typeof name).toBe('string')
    }
  })

  it('CATEGORY_DISPLAY_NAMES has exactly 13 entries', () => {
    expect(Object.keys(CATEGORY_DISPLAY_NAMES)).toHaveLength(13)
  })

  it('falls back to raw category string for unknown categories', () => {
    expect(categoryDisplayName('unknown_category')).toBe('unknown_category')
  })

  it('multi-word categories use space separator in display name', () => {
    expect(categoryDisplayName('mental_health')).toContain(' ')
    expect(categoryDisplayName('addiction_recovery')).toContain(' ')
  })
})

// ---------------------------------------------------------------------------
// Stub functions — verify they exist and throw (EPIC-083c will implement)
// ---------------------------------------------------------------------------

describe('stub functions', () => {
  it('groupAtomsByTopic throws with implementation notice', () => {
    expect(() => groupAtomsByTopic([])).toThrow('not implemented')
  })

  it('renderTopicIndex throws with implementation notice', () => {
    expect(() => renderTopicIndex([])).toThrow('not implemented')
  })

  it('renderTopicPage throws with implementation notice', () => {
    const stubTopic: TopicData = {
      topicId: 'work',
      category: 'work',
      displayName: 'Work',
      atomCount: 0,
      dayCount: 0,
      dateRange: { start: '2024-01-01', end: '2024-01-01' },
      days: [],
    }
    expect(() => renderTopicPage(stubTopic)).toThrow('not implemented')
  })
})
