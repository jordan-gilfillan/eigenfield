/**
 * Export v2 — topics module tests
 *
 * Tests for computeTopicId, categoryDisplayName, TOPIC_VERSION constant,
 * groupAtomsByTopic, renderTopicIndex, and renderTopicPage.
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
import type { ExportDay, TopicData } from '../lib/export/types'

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
// groupAtomsByTopic (§14.11)
// ---------------------------------------------------------------------------

const DAYS_WITH_CATEGORIES: ExportDay[] = [
  {
    dayDate: '2024-01-15',
    outputText: 'Day 1 summary.',
    createdAt: '2024-01-15T23:00:00.000Z',
    bundleHash: 'h1',
    bundleContextHash: 'c1',
    segmented: false,
    atoms: [
      { source: 'chatgpt', timestampUtc: '2024-01-15T10:00:00.000Z', text: 'Work question 1', atomStableId: 'a1', category: 'work' },
      { source: 'chatgpt', timestampUtc: '2024-01-15T11:00:00.000Z', text: 'Work question 2', atomStableId: 'a2', category: 'work' },
      { source: 'chatgpt', timestampUtc: '2024-01-15T12:00:00.000Z', text: 'Learning thing', atomStableId: 'a3', category: 'learning' },
    ],
  },
  {
    dayDate: '2024-01-16',
    outputText: 'Day 2 summary.',
    createdAt: '2024-01-16T23:00:00.000Z',
    bundleHash: 'h2',
    bundleContextHash: 'c2',
    segmented: false,
    atoms: [
      { source: 'chatgpt', timestampUtc: '2024-01-16T10:00:00.000Z', text: 'Work question 3', atomStableId: 'a4', category: 'work' },
      { source: 'chatgpt', timestampUtc: '2024-01-16T14:00:00.000Z', text: 'Learning 2', atomStableId: 'a5', category: 'learning' },
      { source: 'chatgpt', timestampUtc: '2024-01-16T15:00:00.000Z', text: 'Learning 3', atomStableId: 'a6', category: 'learning' },
    ],
  },
]

describe('groupAtomsByTopic', () => {
  it('groups atoms by category into TopicData records', () => {
    const topics = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    expect(topics).toHaveLength(2)

    const work = topics.find((t) => t.topicId === 'work')!
    expect(work.atomCount).toBe(3)
    expect(work.dayCount).toBe(2)
    expect(work.displayName).toBe('Work')

    const learning = topics.find((t) => t.topicId === 'learning')!
    expect(learning.atomCount).toBe(3)
    expect(learning.dayCount).toBe(2)
    expect(learning.displayName).toBe('Learning')
  })

  it('sorts topics: atomCount DESC, category ASC for ties', () => {
    const topics = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    // Both have 3 atoms, so tie-break by category ASC: learning < work
    expect(topics[0].topicId).toBe('learning')
    expect(topics[1].topicId).toBe('work')
  })

  it('assigns atoms without category to other', () => {
    const days: ExportDay[] = [{
      dayDate: '2024-01-15',
      outputText: 'Summary.',
      createdAt: '2024-01-15T23:00:00.000Z',
      bundleHash: 'h1',
      bundleContextHash: 'c1',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2024-01-15T10:00:00.000Z', text: 'No category', atomStableId: 'a1' },
      ],
    }]

    const topics = groupAtomsByTopic(days)
    expect(topics).toHaveLength(1)
    expect(topics[0].topicId).toBe('other')
    expect(topics[0].displayName).toBe('Other')
    expect(topics[0].atomCount).toBe(1)
  })

  it('returns empty array for days with no atoms', () => {
    const days: ExportDay[] = [{
      dayDate: '2024-01-15',
      outputText: 'Summary.',
      createdAt: '2024-01-15T23:00:00.000Z',
      bundleHash: 'h1',
      bundleContextHash: 'c1',
      segmented: false,
    }]

    expect(groupAtomsByTopic(days)).toEqual([])
  })

  it('returns empty array for empty days', () => {
    expect(groupAtomsByTopic([])).toEqual([])
  })

  it('computes correct dateRange for multi-day topics', () => {
    const topics = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    const work = topics.find((t) => t.topicId === 'work')!
    expect(work.dateRange).toEqual({ start: '2024-01-15', end: '2024-01-16' })
  })

  it('sorts days within each topic ascending by dayDate', () => {
    const topics = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    const work = topics.find((t) => t.topicId === 'work')!
    expect(work.days[0].dayDate).toBe('2024-01-15')
    expect(work.days[1].dayDate).toBe('2024-01-16')
  })

  it('counts atoms per day correctly', () => {
    const topics = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    const work = topics.find((t) => t.topicId === 'work')!
    expect(work.days[0]).toEqual({ dayDate: '2024-01-15', atomCount: 2 })
    expect(work.days[1]).toEqual({ dayDate: '2024-01-16', atomCount: 1 })
  })

  it('is deterministic — same input produces identical output', () => {
    const topics1 = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    const topics2 = groupAtomsByTopic(DAYS_WITH_CATEGORIES)
    expect(topics1).toEqual(topics2)
  })
})

// ---------------------------------------------------------------------------
// renderTopicIndex (§14.12)
// ---------------------------------------------------------------------------

describe('renderTopicIndex', () => {
  const TOPICS: TopicData[] = [
    {
      topicId: 'work',
      category: 'work',
      displayName: 'Work',
      atomCount: 45,
      dayCount: 12,
      dateRange: { start: '2024-01-05', end: '2024-01-16' },
      days: [],
    },
    {
      topicId: 'learning',
      category: 'learning',
      displayName: 'Learning',
      atomCount: 23,
      dayCount: 8,
      dateRange: { start: '2024-01-05', end: '2024-01-12' },
      days: [],
    },
  ]

  it('renders markdown table with correct columns', () => {
    const result = renderTopicIndex(TOPICS)
    expect(result).toContain('| Topic | Category | Days | Atoms |')
    expect(result).toContain('|-------|----------|------|-------|')
  })

  it('renders topic rows with links to topic pages', () => {
    const result = renderTopicIndex(TOPICS)
    expect(result).toContain('| [Work](work.md) | work | 12 | 45 |')
    expect(result).toContain('| [Learning](learning.md) | learning | 8 | 23 |')
  })

  it('has no frontmatter', () => {
    const result = renderTopicIndex(TOPICS)
    // No YAML frontmatter delimiters (lines that are exactly "---")
    expect(result).not.toMatch(/^---$/m)
  })

  it('ends with trailing newline', () => {
    const result = renderTopicIndex(TOPICS)
    expect(result.endsWith('\n')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(false)
  })

  it('renders empty table when no topics', () => {
    const result = renderTopicIndex([])
    expect(result).toContain('# Topics')
    expect(result).toContain('| Topic | Category | Days | Atoms |')
    // No data rows
    const lines = result.split('\n')
    const dataRows = lines.filter((l) => l.startsWith('| ['))
    expect(dataRows).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// renderTopicPage (§14.13)
// ---------------------------------------------------------------------------

describe('renderTopicPage', () => {
  const TOPIC: TopicData = {
    topicId: 'work',
    category: 'work',
    displayName: 'Work',
    atomCount: 8,
    dayCount: 3,
    dateRange: { start: '2024-01-14', end: '2024-01-16' },
    days: [
      { dayDate: '2024-01-14', atomCount: 1 },
      { dayDate: '2024-01-15', atomCount: 5 },
      { dayDate: '2024-01-16', atomCount: 2 },
    ],
  }

  it('has YAML frontmatter with correct field order', () => {
    const result = renderTopicPage(TOPIC)
    const fm = result.split('---\n')[1]
    const keys = fm.split('\n').filter(Boolean).map((l) => l.split(':')[0])
    expect(keys).toEqual([
      'topicId', 'topicVersion', 'category', 'displayName',
      'atomCount', 'dayCount', 'dateRange',
    ])
  })

  it('has correct frontmatter values', () => {
    const result = renderTopicPage(TOPIC)
    expect(result).toContain('topicId: "work"')
    expect(result).toContain('topicVersion: "topic_v1"')
    expect(result).toContain('category: "work"')
    expect(result).toContain('displayName: "Work"')
    expect(result).toContain('atomCount: 8')
    expect(result).toContain('dayCount: 3')
    expect(result).toContain('dateRange: "2024-01-14 to 2024-01-16"')
  })

  it('lists days newest-first with relative links', () => {
    const result = renderTopicPage(TOPIC)
    const dayLines = result.split('\n').filter((l) => l.startsWith('- ['))
    expect(dayLines).toHaveLength(3)
    // Newest first
    expect(dayLines[0]).toContain('2024-01-16')
    expect(dayLines[1]).toContain('2024-01-15')
    expect(dayLines[2]).toContain('2024-01-14')
  })

  it('uses relative paths from topics/ to views/', () => {
    const result = renderTopicPage(TOPIC)
    expect(result).toContain('](../views/2024-01-16.md)')
  })

  it('uses singular "atom" when count is 1', () => {
    const result = renderTopicPage(TOPIC)
    expect(result).toContain('(1 atom)')
    expect(result).not.toContain('(1 atoms)')
  })

  it('uses plural "atoms" when count > 1', () => {
    const result = renderTopicPage(TOPIC)
    expect(result).toContain('(5 atoms)')
    expect(result).toContain('(2 atoms)')
  })

  it('has ## Days heading', () => {
    const result = renderTopicPage(TOPIC)
    expect(result).toContain('## Days')
  })

  it('ends with trailing newline', () => {
    const result = renderTopicPage(TOPIC)
    expect(result.endsWith('\n')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(false)
  })

  it('renders multi-word display names correctly', () => {
    const topic: TopicData = {
      topicId: 'mental_health',
      category: 'mental_health',
      displayName: 'Mental Health',
      atomCount: 3,
      dayCount: 1,
      dateRange: { start: '2024-01-15', end: '2024-01-15' },
      days: [{ dayDate: '2024-01-15', atomCount: 3 }],
    }
    const result = renderTopicPage(topic)
    expect(result).toContain('topicId: "mental_health"')
    expect(result).toContain('displayName: "Mental Health"')
  })
})
