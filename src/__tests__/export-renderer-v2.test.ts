/**
 * Export v2 renderer tests
 *
 * Golden fixture + determinism + byte-stability tests for v2 mode.
 * V2 adds: topics/INDEX.md, topics/<topicId>.md, changelog.md, v2 manifest.
 *
 * Spec reference: §14.10–§14.17
 */

import { describe, it, expect } from 'vitest'
import { renderExportTree } from '../lib/export/renderer'
import { sha256 } from '../lib/hash'
import type { ExportInput, PreviousManifest } from '../lib/export/types'

// ---------------------------------------------------------------------------
// V2 golden fixture: 2 categories, 2 days, with previousManifest
// ---------------------------------------------------------------------------

const V2_GOLDEN_INPUT: ExportInput = {
  run: {
    id: 'run_v2_001',
    model: 'gpt-4o',
    startDate: '2024-01-15',
    endDate: '2024-01-16',
    sources: ['chatgpt'],
    timezone: 'America/Los_Angeles',
    filterProfile: { name: 'default', mode: 'include', categories: ['work', 'learning'] },
  },
  batches: [{
    id: 'batch_v2_001',
    source: 'chatgpt',
    originalFilename: 'conversations.json',
    timezone: 'America/Los_Angeles',
  }],
  days: [
    {
      dayDate: '2024-01-15',
      outputText: 'Worked on auth module. Studied TypeScript generics.',
      createdAt: '2024-01-15T23:45:00.000Z',
      bundleHash: 'abc123def456',
      bundleContextHash: 'ctx789abc012',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2024-01-15T10:30:00.000Z', text: 'Auth question', atomStableId: 'a1', category: 'work' },
        { source: 'chatgpt', timestampUtc: '2024-01-15T11:00:00.000Z', text: 'More auth work', atomStableId: 'a2', category: 'work' },
        { source: 'chatgpt', timestampUtc: '2024-01-15T14:00:00.000Z', text: 'TS generics study', atomStableId: 'a3', category: 'learning' },
      ],
    },
    {
      dayDate: '2024-01-16',
      outputText: 'Code review and deployment planning.',
      createdAt: '2024-01-16T22:30:00.000Z',
      bundleHash: 'def456ghi789',
      bundleContextHash: 'ctx345def678',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2024-01-16T09:00:00.000Z', text: 'Code review feedback', atomStableId: 'a4', category: 'work' },
        { source: 'chatgpt', timestampUtc: '2024-01-16T15:30:00.000Z', text: 'Deployment docs', atomStableId: 'a5', category: 'work' },
      ],
    },
  ],
  exportedAt: '2024-01-20T15:30:00.000Z',
  topicVersion: 'topic_v1',
}

const PREVIOUS_MANIFEST: PreviousManifest = {
  exportedAt: '2024-01-10T00:00:00.000Z',
  topicVersion: 'topic_v1',
  topics: {
    work: {
      atomCount: 3,
      category: 'work',
      dayCount: 1,
      days: ['2024-01-10'],
      displayName: 'Work',
    },
  },
}

// V2 input WITH previousManifest (changelog generated)
const V2_WITH_CHANGELOG: ExportInput = {
  ...V2_GOLDEN_INPUT,
  previousManifest: PREVIOUS_MANIFEST,
}

// ---- Golden expected strings for v2 ----

const GOLDEN_README_V2 = `# Journal Distiller Export

Format: export_v2

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

const GOLDEN_TOPIC_INDEX = `# Topics

| Topic | Category | Days | Atoms |
|-------|----------|------|-------|
| [Work](work.md) | work | 2 | 4 |
| [Learning](learning.md) | learning | 1 | 1 |
`

const GOLDEN_TOPIC_WORK = `---
topicId: "work"
topicVersion: "topic_v1"
category: "work"
displayName: "Work"
atomCount: 4
dayCount: 2
dateRange: "2024-01-15 to 2024-01-16"
---

## Days

- [2024-01-16](../views/2024-01-16.md) (2 atoms)
- [2024-01-15](../views/2024-01-15.md) (2 atoms)
`

const GOLDEN_TOPIC_LEARNING = `---
topicId: "learning"
topicVersion: "topic_v1"
category: "learning"
displayName: "Learning"
atomCount: 1
dayCount: 1
dateRange: "2024-01-15 to 2024-01-15"
---

## Days

- [2024-01-15](../views/2024-01-15.md) (1 atom)
`

const GOLDEN_CHANGELOG = `---
exportedAt: "2024-01-20T15:30:00.000Z"
previousExportedAt: "2024-01-10T00:00:00.000Z"
topicVersion: "topic_v1"
changeCount: 2
---

## New topics

- **Learning** (\`learning\`) — 1 days, 1 atoms

## Changed topics

### Work (\`work\`)
- Days added: 2024-01-15, 2024-01-16
- Days removed: 2024-01-10
- Atom count: 3 → 4 (+1)
`

// ---- Tests ----

describe('renderExportTree v2', () => {
  describe('golden fixture (no previousManifest)', () => {
    it('produces all expected files', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const paths = [...tree.keys()].sort()

      expect(paths).toEqual([
        '.journal-meta/manifest.json',
        'README.md',
        'atoms/2024-01-15.md',
        'atoms/2024-01-16.md',
        'sources/chatgpt-conversations.md',
        'topics/INDEX.md',
        'topics/learning.md',
        'topics/work.md',
        'views/2024-01-15.md',
        'views/2024-01-16.md',
        'views/timeline.md',
      ])
    })

    it('README.md matches v2 golden', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      expect(tree.get('README.md')).toBe(GOLDEN_README_V2)
    })

    it('topics/INDEX.md matches golden', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      expect(tree.get('topics/INDEX.md')).toBe(GOLDEN_TOPIC_INDEX)
    })

    it('topics/work.md matches golden', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      expect(tree.get('topics/work.md')).toBe(GOLDEN_TOPIC_WORK)
    })

    it('topics/learning.md matches golden', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      expect(tree.get('topics/learning.md')).toBe(GOLDEN_TOPIC_LEARNING)
    })

    it('no changelog.md when no previousManifest', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      expect(tree.has('changelog.md')).toBe(false)
    })

    it('manifest has formatVersion export_v2', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.formatVersion).toBe('export_v2')
    })

    it('manifest has topicVersion', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.topicVersion).toBe('topic_v1')
    })

    it('manifest has topics data', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.topics.work).toEqual({
        atomCount: 4,
        category: 'work',
        dayCount: 2,
        days: ['2024-01-15', '2024-01-16'],
        displayName: 'Work',
      })
      expect(manifest.topics.learning).toEqual({
        atomCount: 1,
        category: 'learning',
        dayCount: 1,
        days: ['2024-01-15'],
        displayName: 'Learning',
      })
    })

    it('manifest has changelog: null when no previousManifest', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.changelog).toBeNull()
    })

    it('manifest file hashes are correct for all files', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)

      for (const [path, content] of tree) {
        if (path === '.journal-meta/manifest.json') continue
        expect(manifest.files[path].sha256).toBe(sha256(content))
      }
    })

    it('manifest includes topic files in file hashes', () => {
      const tree = renderExportTree(V2_GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.files['topics/INDEX.md']).toBeDefined()
      expect(manifest.files['topics/work.md']).toBeDefined()
      expect(manifest.files['topics/learning.md']).toBeDefined()
    })
  })

  describe('golden fixture (with previousManifest)', () => {
    it('produces changelog.md', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      expect(tree.has('changelog.md')).toBe(true)
    })

    it('changelog.md matches golden', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      expect(tree.get('changelog.md')).toBe(GOLDEN_CHANGELOG)
    })

    it('manifest has changelog summary', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.changelog).toEqual({
        changeCount: 2,
        previousExportedAt: '2024-01-10T00:00:00.000Z',
      })
    })

    it('manifest includes changelog.md in file hashes', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.files['changelog.md']).toBeDefined()
      expect(manifest.files['changelog.md'].sha256).toBe(sha256(tree.get('changelog.md')!))
    })
  })

  describe('v2 determinism', () => {
    it('same input produces identical output (no changelog)', () => {
      const tree1 = renderExportTree(V2_GOLDEN_INPUT)
      const tree2 = renderExportTree(V2_GOLDEN_INPUT)

      expect(tree1.size).toBe(tree2.size)
      for (const [path, content] of tree1) {
        expect(tree2.get(path), `${path} diverged`).toBe(content)
      }
    })

    it('same input produces identical output (with changelog)', () => {
      const tree1 = renderExportTree(V2_WITH_CHANGELOG)
      const tree2 = renderExportTree(V2_WITH_CHANGELOG)

      expect(tree1.size).toBe(tree2.size)
      for (const [path, content] of tree1) {
        expect(tree2.get(path), `${path} diverged`).toBe(content)
      }
    })
  })

  describe('v2 byte stability', () => {
    it('all files end with exactly one newline', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      for (const [path, content] of tree) {
        expect(content.endsWith('\n'), `${path} must end with newline`).toBe(true)
        expect(content.endsWith('\n\n'), `${path} must not end with double newline`).toBe(false)
      }
    })

    it('no file contains CRLF', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      for (const [path, content] of tree) {
        expect(content.includes('\r'), `${path} must not contain CR`).toBe(false)
      }
    })

    it('no line has trailing whitespace', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      for (const [path, content] of tree) {
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          expect(
            line === line.trimEnd(),
            `${path} line ${i + 1} has trailing whitespace: "${line}"`,
          ).toBe(true)
        }
      }
    })
  })

  describe('v2 exportedAt isolation', () => {
    it('changing exportedAt changes ONLY manifest.json and changelog.md', () => {
      const tree1 = renderExportTree(V2_WITH_CHANGELOG)
      const tree2 = renderExportTree({
        ...V2_WITH_CHANGELOG,
        exportedAt: '2099-12-31T23:59:59.000Z',
      })

      for (const [path, content] of tree1) {
        if (path === '.journal-meta/manifest.json' || path === 'changelog.md') {
          expect(tree2.get(path)).not.toBe(content)
        } else {
          expect(tree2.get(path), `${path} must not change when exportedAt changes`).toBe(content)
        }
      }
    })
  })

  describe('v2 backward compatibility', () => {
    it('v1 input (no topicVersion) still produces v1 output', () => {
      const v1Input: ExportInput = {
        ...V2_GOLDEN_INPUT,
        topicVersion: undefined,
      }
      const tree = renderExportTree(v1Input)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)

      expect(manifest.formatVersion).toBe('export_v1')
      expect(manifest.topics).toBeUndefined()
      expect(manifest.topicVersion).toBeUndefined()
      expect(tree.has('topics/INDEX.md')).toBe(false)
      expect(tree.has('changelog.md')).toBe(false)
    })

    it('v1 views are identical between v1 and v2 mode', () => {
      const v1Tree = renderExportTree({ ...V2_GOLDEN_INPUT, topicVersion: undefined })
      const v2Tree = renderExportTree(V2_GOLDEN_INPUT)

      expect(v2Tree.get('views/timeline.md')).toBe(v1Tree.get('views/timeline.md'))
      expect(v2Tree.get('views/2024-01-15.md')).toBe(v1Tree.get('views/2024-01-15.md'))
      expect(v2Tree.get('views/2024-01-16.md')).toBe(v1Tree.get('views/2024-01-16.md'))
    })
  })

  describe('v2 privacy tiers', () => {
    it('public tier includes topics/ (no raw atom text)', () => {
      const tree = renderExportTree({ ...V2_GOLDEN_INPUT, privacyTier: 'public' })
      expect(tree.has('topics/INDEX.md')).toBe(true)
      expect(tree.has('topics/work.md')).toBe(true)
      expect(tree.has('topics/learning.md')).toBe(true)
    })

    it('public tier includes changelog.md', () => {
      const tree = renderExportTree({ ...V2_WITH_CHANGELOG, privacyTier: 'public' })
      expect(tree.has('changelog.md')).toBe(true)
    })

    it('public tier omits atoms/ and sources/ but keeps topics/', () => {
      const tree = renderExportTree({ ...V2_GOLDEN_INPUT, privacyTier: 'public' })
      const paths = [...tree.keys()]

      expect(paths.some((p) => p.startsWith('atoms/'))).toBe(false)
      expect(paths.some((p) => p.startsWith('sources/'))).toBe(false)
      expect(paths.some((p) => p.startsWith('topics/'))).toBe(true)
    })

    it('topic pages are identical between public and private tiers', () => {
      const publicTree = renderExportTree({ ...V2_GOLDEN_INPUT, privacyTier: 'public' })
      const privateTree = renderExportTree({ ...V2_GOLDEN_INPUT, privacyTier: 'private' })

      expect(publicTree.get('topics/INDEX.md')).toBe(privateTree.get('topics/INDEX.md'))
      expect(publicTree.get('topics/work.md')).toBe(privateTree.get('topics/work.md'))
      expect(publicTree.get('topics/learning.md')).toBe(privateTree.get('topics/learning.md'))
    })
  })

  describe('v2 manifest sorted keys', () => {
    it('all manifest keys are alphabetically sorted', () => {
      const tree = renderExportTree(V2_WITH_CHANGELOG)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)

      const topKeys = Object.keys(manifest)
      expect(topKeys).toEqual([...topKeys].sort())

      const runKeys = Object.keys(manifest.run)
      expect(runKeys).toEqual([...runKeys].sort())

      const topicKeys = Object.keys(manifest.topics)
      expect(topicKeys).toEqual([...topicKeys].sort())

      // Each topic entry
      for (const topicId of topicKeys) {
        const entryKeys = Object.keys(manifest.topics[topicId])
        expect(entryKeys).toEqual([...entryKeys].sort())
      }
    })
  })
})
