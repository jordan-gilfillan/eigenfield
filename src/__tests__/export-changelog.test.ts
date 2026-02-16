/**
 * Export v2 — changelog module tests
 *
 * Tests for computeChangelog and renderChangelog.
 *
 * Spec reference: §14.14
 */

import { describe, it, expect } from 'vitest'
import { computeChangelog, renderChangelog } from '../lib/export/changelog'
import type { PreviousManifest, TopicData, ChangelogData } from '../lib/export/types'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CURRENT_TOPICS: TopicData[] = [
  {
    topicId: 'work',
    category: 'work',
    displayName: 'Work',
    atomCount: 45,
    dayCount: 12,
    dateRange: { start: '2024-01-05', end: '2024-01-19' },
    days: [
      { dayDate: '2024-01-05', atomCount: 3 },
      { dayDate: '2024-01-06', atomCount: 4 },
      { dayDate: '2024-01-18', atomCount: 5 },
      { dayDate: '2024-01-19', atomCount: 33 },
    ],
  },
  {
    topicId: 'learning',
    category: 'learning',
    displayName: 'Learning',
    atomCount: 23,
    dayCount: 3,
    dateRange: { start: '2024-01-05', end: '2024-01-07' },
    days: [
      { dayDate: '2024-01-05', atomCount: 8 },
      { dayDate: '2024-01-06', atomCount: 10 },
      { dayDate: '2024-01-07', atomCount: 5 },
    ],
  },
]

const PREVIOUS_MANIFEST: PreviousManifest = {
  exportedAt: '2024-01-15T00:00:00.000Z',
  topicVersion: 'topic_v1',
  topics: {
    work: {
      atomCount: 40,
      category: 'work',
      dayCount: 10,
      days: ['2024-01-05', '2024-01-06'],
      displayName: 'Work',
    },
    creative: {
      atomCount: 8,
      category: 'creative',
      dayCount: 3,
      days: ['2024-01-05', '2024-01-06', '2024-01-07'],
      displayName: 'Creative',
    },
  },
}

// ---------------------------------------------------------------------------
// computeChangelog (§14.14)
// ---------------------------------------------------------------------------

describe('computeChangelog', () => {
  it('detects new topics (current − previous)', () => {
    const result = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    expect(result.newTopics).toHaveLength(1)
    expect(result.newTopics[0].topicId).toBe('learning')
    expect(result.newTopics[0].displayName).toBe('Learning')
    expect(result.newTopics[0].dayCount).toBe(3)
    expect(result.newTopics[0].atomCount).toBe(23)
  })

  it('detects removed topics (previous − current)', () => {
    const result = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    expect(result.removedTopics).toHaveLength(1)
    expect(result.removedTopics[0].topicId).toBe('creative')
    expect(result.removedTopics[0].displayName).toBe('Creative')
    expect(result.removedTopics[0].previousDayCount).toBe(3)
    expect(result.removedTopics[0].previousAtomCount).toBe(8)
  })

  it('detects changed topics (intersection with diffs)', () => {
    const result = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    expect(result.changedTopics).toHaveLength(1)
    const work = result.changedTopics[0]
    expect(work.topicId).toBe('work')
    expect(work.daysAdded).toEqual(['2024-01-18', '2024-01-19'])
    expect(work.daysRemoved).toEqual([])
    expect(work.previousAtomCount).toBe(40)
    expect(work.currentAtomCount).toBe(45)
  })

  it('computes correct changeCount', () => {
    const result = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    // 1 new + 1 removed + 1 changed = 3
    expect(result.changeCount).toBe(3)
  })

  it('returns zero changes for identical data', () => {
    const prev: PreviousManifest = {
      exportedAt: '2024-01-15T00:00:00.000Z',
      topicVersion: 'topic_v1',
      topics: {
        work: {
          atomCount: 45,
          category: 'work',
          dayCount: 4,
          days: ['2024-01-05', '2024-01-06', '2024-01-18', '2024-01-19'],
          displayName: 'Work',
        },
        learning: {
          atomCount: 23,
          category: 'learning',
          dayCount: 3,
          days: ['2024-01-05', '2024-01-06', '2024-01-07'],
          displayName: 'Learning',
        },
      },
    }

    const result = computeChangelog(CURRENT_TOPICS, prev)
    expect(result.newTopics).toHaveLength(0)
    expect(result.removedTopics).toHaveLength(0)
    expect(result.changedTopics).toHaveLength(0)
    expect(result.changeCount).toBe(0)
  })

  it('detects day removal as a change', () => {
    const topics: TopicData[] = [{
      topicId: 'work',
      category: 'work',
      displayName: 'Work',
      atomCount: 10,
      dayCount: 1,
      dateRange: { start: '2024-01-06', end: '2024-01-06' },
      days: [{ dayDate: '2024-01-06', atomCount: 10 }],
    }]

    const prev: PreviousManifest = {
      exportedAt: '2024-01-10T00:00:00.000Z',
      topicVersion: 'topic_v1',
      topics: {
        work: {
          atomCount: 10,
          category: 'work',
          dayCount: 2,
          days: ['2024-01-05', '2024-01-06'],
          displayName: 'Work',
        },
      },
    }

    const result = computeChangelog(topics, prev)
    expect(result.changedTopics).toHaveLength(1)
    expect(result.changedTopics[0].daysRemoved).toEqual(['2024-01-05'])
    expect(result.changedTopics[0].daysAdded).toEqual([])
  })

  it('sorts entries within each section by display name ascending', () => {
    const topics: TopicData[] = [
      { topicId: 'work', category: 'work', displayName: 'Work', atomCount: 5, dayCount: 1, dateRange: { start: '2024-01-15', end: '2024-01-15' }, days: [{ dayDate: '2024-01-15', atomCount: 5 }] },
      { topicId: 'learning', category: 'learning', displayName: 'Learning', atomCount: 3, dayCount: 1, dateRange: { start: '2024-01-15', end: '2024-01-15' }, days: [{ dayDate: '2024-01-15', atomCount: 3 }] },
    ]

    const prev: PreviousManifest = {
      exportedAt: '2024-01-10T00:00:00.000Z',
      topicVersion: 'topic_v1',
      topics: {},
    }

    const result = computeChangelog(topics, prev)
    // Both are new, sorted: Learning before Work
    expect(result.newTopics[0].displayName).toBe('Learning')
    expect(result.newTopics[1].displayName).toBe('Work')
  })

  it('is deterministic — same input produces identical output', () => {
    const r1 = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    const r2 = computeChangelog(CURRENT_TOPICS, PREVIOUS_MANIFEST)
    expect(r1).toEqual(r2)
  })
})

// ---------------------------------------------------------------------------
// renderChangelog (§14.14)
// ---------------------------------------------------------------------------

describe('renderChangelog', () => {
  const CHANGELOG: ChangelogData = {
    newTopics: [
      { topicId: 'learning', displayName: 'Learning', dayCount: 3, atomCount: 23 },
    ],
    removedTopics: [
      { topicId: 'creative', displayName: 'Creative', previousDayCount: 3, previousAtomCount: 8 },
    ],
    changedTopics: [
      {
        topicId: 'work',
        displayName: 'Work',
        daysAdded: ['2024-01-18', '2024-01-19'],
        daysRemoved: [],
        previousAtomCount: 40,
        currentAtomCount: 45,
      },
    ],
    changeCount: 3,
  }

  it('has YAML frontmatter with correct field order', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    const fm = result.split('---\n')[1]
    const keys = fm.split('\n').filter(Boolean).map((l) => l.split(':')[0])
    expect(keys).toEqual(['exportedAt', 'previousExportedAt', 'topicVersion', 'changeCount'])
  })

  it('has correct frontmatter values', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('exportedAt: "2024-01-20T00:00:00.000Z"')
    expect(result).toContain('previousExportedAt: "2024-01-15T00:00:00.000Z"')
    expect(result).toContain('topicVersion: "topic_v1"')
    expect(result).toContain('changeCount: 3')
  })

  it('renders new topics section', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('## New topics')
    expect(result).toContain('- **Learning** (`learning`) — 3 days, 23 atoms')
  })

  it('renders removed topics section', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('## Removed topics')
    expect(result).toContain('- **Creative** (`creative`) — was 3 days, 8 atoms')
  })

  it('renders changed topics section', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('## Changed topics')
    expect(result).toContain('### Work (`work`)')
    expect(result).toContain('- Days added: 2024-01-18, 2024-01-19')
    expect(result).toContain('- Days removed: (none)')
    expect(result).toContain('- Atom count: 40 → 45 (+5)')
  })

  it('omits empty sections', () => {
    const noChanges: ChangelogData = {
      newTopics: [{ topicId: 'work', displayName: 'Work', dayCount: 1, atomCount: 5 }],
      removedTopics: [],
      changedTopics: [],
      changeCount: 1,
    }
    const result = renderChangelog(noChanges, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('## New topics')
    expect(result).not.toContain('## Removed topics')
    expect(result).not.toContain('## Changed topics')
  })

  it('renders negative atom count delta', () => {
    const decreased: ChangelogData = {
      newTopics: [],
      removedTopics: [],
      changedTopics: [{
        topicId: 'work',
        displayName: 'Work',
        daysAdded: [],
        daysRemoved: ['2024-01-05'],
        previousAtomCount: 20,
        currentAtomCount: 15,
      }],
      changeCount: 1,
    }
    const result = renderChangelog(decreased, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result).toContain('- Atom count: 20 → 15 (-5)')
  })

  it('ends with trailing newline', () => {
    const result = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(result.endsWith('\n')).toBe(true)
    expect(result.endsWith('\n\n')).toBe(false)
  })

  it('is deterministic — same input produces identical output', () => {
    const r1 = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    const r2 = renderChangelog(CHANGELOG, '2024-01-20T00:00:00.000Z', '2024-01-15T00:00:00.000Z', 'topic_v1')
    expect(r1).toBe(r2)
  })
})
