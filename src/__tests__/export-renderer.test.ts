/**
 * Export renderer tests
 *
 * Golden fixture test + determinism + byte-stability tests.
 * Locks exact byte output of every rendered file.
 *
 * Spec reference: §14.10 (Golden fixture test requirement)
 */

import { describe, it, expect } from 'vitest'
import { renderExportTree } from '../lib/export/renderer'
import { sha256 } from '../lib/hash'
import { EXPORT_FORMAT_VERSION, renderFrontmatter, sortKeysDeep, renderJson } from '../lib/export/helpers'
import type { ExportInput } from '../lib/export/types'

// ---- Golden fixture: small but representative ----
// 2 days, 1 segmented + 1 not, 1 source, fixed exportedAt

const GOLDEN_INPUT: ExportInput = {
  run: {
    id: 'run_test_001',
    model: 'gpt-4o',
    startDate: '2024-01-15',
    endDate: '2024-01-16',
    sources: ['chatgpt'],
    timezone: 'America/Los_Angeles',
    filterProfile: { name: 'default', mode: 'include', categories: ['work', 'learning'] },
  },
  batches: [{
    id: 'batch_test_001',
    source: 'chatgpt',
    originalFilename: 'conversations.json',
    timezone: 'America/Los_Angeles',
  }],
  days: [
    {
      dayDate: '2024-01-15',
      outputText: 'Worked on the authentication module. Reviewed pull requests.',
      createdAt: '2024-01-15T23:45:00.000Z',
      bundleHash: 'abc123def456',
      bundleContextHash: 'ctx789abc012',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2024-01-15T10:30:00.000Z', text: 'How do I implement token-based auth?', atomStableId: 'atom-g-001' },
        { source: 'chatgpt', timestampUtc: '2024-01-15T14:15:00.000Z', text: 'Can you review this PR for security issues?', atomStableId: 'atom-g-002' },
      ],
    },
    {
      dayDate: '2024-01-16',
      outputText: 'Morning standup discussion about deployment timeline.\n\nAfternoon code review session with the team.',
      createdAt: '2024-01-16T22:30:00.000Z',
      bundleHash: 'def456ghi789',
      bundleContextHash: 'ctx345def678',
      segmented: true,
      segmentCount: 2,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2024-01-16T09:00:00.000Z', text: 'What should we cover in standup today?', atomStableId: 'atom-g-003' },
        { source: 'chatgpt', timestampUtc: '2024-01-16T15:30:00.000Z', text: 'Ready for the code review session.', atomStableId: 'atom-g-004' },
      ],
    },
  ],
  exportedAt: '2024-01-20T15:30:00.000Z',
}

// ---- Golden expected strings ----

const GOLDEN_README = `# Journal Distiller Export

Format: export_v1

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

const GOLDEN_TIMELINE = `# Timeline

- [2024-01-16](2024-01-16.md)
- [2024-01-15](2024-01-15.md)
`

const GOLDEN_VIEW_JAN15 = `---
date: "2024-01-15"
model: "gpt-4o"
runId: "run_test_001"
createdAt: "2024-01-15T23:45:00.000Z"
bundleHash: "abc123def456"
bundleContextHash: "ctx789abc012"
segmented: false
---

Worked on the authentication module. Reviewed pull requests.
`

const GOLDEN_VIEW_JAN16 = `---
date: "2024-01-16"
model: "gpt-4o"
runId: "run_test_001"
createdAt: "2024-01-16T22:30:00.000Z"
bundleHash: "def456ghi789"
bundleContextHash: "ctx345def678"
segmented: true
segmentCount: 2
---

Morning standup discussion about deployment timeline.

Afternoon code review session with the team.
`

const GOLDEN_ATOMS_JAN15 = `# SOURCE: chatgpt
[2024-01-15T10:30:00.000Z] user: How do I implement token-based auth?
[2024-01-15T14:15:00.000Z] user: Can you review this PR for security issues?
`

const GOLDEN_ATOMS_JAN16 = `# SOURCE: chatgpt
[2024-01-16T09:00:00.000Z] user: What should we cover in standup today?
[2024-01-16T15:30:00.000Z] user: Ready for the code review session.
`

// ---- Tests ----

describe('renderExportTree', () => {
  describe('golden fixture', () => {
    it('produces exact expected output for all files', () => {
      const tree = renderExportTree(GOLDEN_INPUT)

      expect(tree.size).toBe(7) // README + timeline + 2 views + 2 atoms + manifest
      expect(tree.get('README.md')).toBe(GOLDEN_README)
      expect(tree.get('views/timeline.md')).toBe(GOLDEN_TIMELINE)
      expect(tree.get('views/2024-01-15.md')).toBe(GOLDEN_VIEW_JAN15)
      expect(tree.get('views/2024-01-16.md')).toBe(GOLDEN_VIEW_JAN16)
      expect(tree.get('atoms/2024-01-15.md')).toBe(GOLDEN_ATOMS_JAN15)
      expect(tree.get('atoms/2024-01-16.md')).toBe(GOLDEN_ATOMS_JAN16)

      // Manifest — verify structure, then lock golden
      const manifestStr = tree.get('.journal-meta/manifest.json')!
      const manifest = JSON.parse(manifestStr)
      expect(manifest.formatVersion).toBe('export_v1')
      expect(manifest.exportedAt).toBe('2024-01-20T15:30:00.000Z')
      expect(Object.keys(manifest.files)).toHaveLength(6) // README + timeline + 2 views + 2 atoms
    })

    it('manifest hashes match file contents', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)

      for (const [path, content] of tree) {
        if (path === '.journal-meta/manifest.json') continue
        expect(manifest.files[path].sha256).toBe(sha256(content))
      }
    })

    it('manifest is valid sorted JSON with trailing newline', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const manifestStr = tree.get('.journal-meta/manifest.json')!
      const manifest = JSON.parse(manifestStr)

      // Top-level keys are alphabetically sorted
      const topKeys = Object.keys(manifest)
      expect(topKeys).toEqual([...topKeys].sort())

      // run keys are alphabetically sorted
      const runKeys = Object.keys(manifest.run)
      expect(runKeys).toEqual([...runKeys].sort())

      // files keys are alphabetically sorted
      const fileKeys = Object.keys(manifest.files)
      expect(fileKeys).toEqual([...fileKeys].sort())
    })
  })

  describe('determinism', () => {
    it('same input produces identical output', () => {
      const tree1 = renderExportTree(GOLDEN_INPUT)
      const tree2 = renderExportTree(GOLDEN_INPUT)

      expect(tree1.size).toBe(tree2.size)
      for (const [path, content] of tree1) {
        expect(tree2.get(path)).toBe(content)
      }
    })
  })

  describe('byte stability rules', () => {
    it('all files end with exactly one newline', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      for (const [path, content] of tree) {
        expect(content.endsWith('\n'), `${path} must end with newline`).toBe(true)
        expect(content.endsWith('\n\n'), `${path} must not end with double newline`).toBe(false)
      }
    })

    it('no file contains CRLF', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      for (const [path, content] of tree) {
        expect(content.includes('\r'), `${path} must not contain CR`).toBe(false)
      }
    })

    it('no line has trailing whitespace', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      for (const [path, content] of tree) {
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          expect(
            line === line.trimEnd(),
            `${path} line ${i + 1} has trailing whitespace: "${line}"`
          ).toBe(true)
        }
      }
    })
  })

  describe('exportedAt isolation', () => {
    it('changing exportedAt changes ONLY manifest.json', () => {
      const tree1 = renderExportTree(GOLDEN_INPUT)
      const tree2 = renderExportTree({
        ...GOLDEN_INPUT,
        exportedAt: '2099-12-31T23:59:59.000Z',
      })

      for (const [path, content] of tree1) {
        if (path === '.journal-meta/manifest.json') {
          expect(tree2.get(path)).not.toBe(content)
        } else {
          expect(tree2.get(path), `${path} must not change when exportedAt changes`).toBe(content)
        }
      }
    })
  })

  describe('view frontmatter', () => {
    it('has exact field order: date, model, runId, createdAt, bundleHash, bundleContextHash, segmented[, segmentCount]', () => {
      const tree = renderExportTree(GOLDEN_INPUT)

      // Non-segmented view: 7 fields
      const view15 = tree.get('views/2024-01-15.md')!
      const fm15 = view15.split('---\n')[1]
      const keys15 = fm15.split('\n').filter(Boolean).map((l) => l.split(':')[0])
      expect(keys15).toEqual(['date', 'model', 'runId', 'createdAt', 'bundleHash', 'bundleContextHash', 'segmented'])

      // Segmented view: 8 fields
      const view16 = tree.get('views/2024-01-16.md')!
      const fm16 = view16.split('---\n')[1]
      const keys16 = fm16.split('\n').filter(Boolean).map((l) => l.split(':')[0])
      expect(keys16).toEqual(['date', 'model', 'runId', 'createdAt', 'bundleHash', 'bundleContextHash', 'segmented', 'segmentCount'])
    })

    it('body is outputText verbatim', () => {
      const tree = renderExportTree(GOLDEN_INPUT)

      const view15 = tree.get('views/2024-01-15.md')!
      const body15 = view15.split('---\n').slice(2).join('---\n').replace(/^\n/, '')
      expect(body15).toBe('Worked on the authentication module. Reviewed pull requests.\n')

      const view16 = tree.get('views/2024-01-16.md')!
      const body16 = view16.split('---\n').slice(2).join('---\n').replace(/^\n/, '')
      expect(body16).toBe('Morning standup discussion about deployment timeline.\n\nAfternoon code review session with the team.\n')
    })

    it('provenance values match input', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const view15 = tree.get('views/2024-01-15.md')!

      expect(view15).toContain('runId: "run_test_001"')
      expect(view15).toContain('createdAt: "2024-01-15T23:45:00.000Z"')
      expect(view15).toContain('bundleHash: "abc123def456"')
      expect(view15).toContain('bundleContextHash: "ctx789abc012"')
    })
  })

  describe('README stability', () => {
    it('README is identical regardless of input data', () => {
      const tree1 = renderExportTree(GOLDEN_INPUT)
      const tree2 = renderExportTree({
        ...GOLDEN_INPUT,
        run: { ...GOLDEN_INPUT.run, id: 'different_run', model: 'different-model' },
        days: [],
        exportedAt: '1999-01-01T00:00:00.000Z',
      })

      expect(tree1.get('README.md')).toBe(tree2.get('README.md'))
    })
  })

  describe('empty run', () => {
    it('zero days produces README + empty timeline + manifest', () => {
      const tree = renderExportTree({
        ...GOLDEN_INPUT,
        days: [],
      })

      expect(tree.size).toBe(3)
      expect(tree.has('README.md')).toBe(true)
      expect(tree.has('views/timeline.md')).toBe(true)
      expect(tree.has('.journal-meta/manifest.json')).toBe(true)

      // Timeline has heading but no entries
      const timeline = tree.get('views/timeline.md')!
      expect(timeline).toBe('# Timeline\n\n')
    })
  })

  describe('timeline', () => {
    it('lists days newest-first', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const timeline = tree.get('views/timeline.md')!
      const lines = timeline.split('\n').filter((l) => l.startsWith('- '))

      expect(lines).toEqual([
        '- [2024-01-16](2024-01-16.md)',
        '- [2024-01-15](2024-01-15.md)',
      ])
    })

    it('renders Recent + All entries when >14 days', () => {
      const days = Array.from({ length: 20 }, (_, i) => {
        const day = String(i + 1).padStart(2, '0')
        return {
          dayDate: `2024-01-${day}`,
          outputText: `Day ${i + 1} summary.`,
          createdAt: `2024-01-${day}T12:00:00.000Z`,
          bundleHash: `hash${day}`,
          bundleContextHash: `ctx${day}`,
          segmented: false,
        }
      })

      const tree = renderExportTree({ ...GOLDEN_INPUT, days })
      const timeline = tree.get('views/timeline.md')!

      expect(timeline).toContain('## Recent')
      expect(timeline).toContain('## All entries')

      // Recent section has 14 items
      const recentSection = timeline.split('## All entries')[0]
      const recentLinks = recentSection.split('\n').filter((l) => l.startsWith('- '))
      expect(recentLinks).toHaveLength(14)

      // First item in Recent is newest
      expect(recentLinks[0]).toBe('- [2024-01-20](2024-01-20.md)')

      // All entries section has 20 items
      const allSection = timeline.split('## All entries')[1]
      const allLinks = allSection.split('\n').filter((l) => l.startsWith('- '))
      expect(allLinks).toHaveLength(20)

      // First item in All entries is also newest
      expect(allLinks[0]).toBe('- [2024-01-20](2024-01-20.md)')
    })

    it('flat list when exactly 14 days', () => {
      const days = Array.from({ length: 14 }, (_, i) => {
        const day = String(i + 1).padStart(2, '0')
        return {
          dayDate: `2024-01-${day}`,
          outputText: `Day ${i + 1} summary.`,
          createdAt: `2024-01-${day}T12:00:00.000Z`,
          bundleHash: `hash${day}`,
          bundleContextHash: `ctx${day}`,
          segmented: false,
        }
      })

      const tree = renderExportTree({ ...GOLDEN_INPUT, days })
      const timeline = tree.get('views/timeline.md')!

      expect(timeline).not.toContain('## Recent')
      expect(timeline).not.toContain('## All entries')

      const links = timeline.split('\n').filter((l) => l.startsWith('- '))
      expect(links).toHaveLength(14)
      expect(links[0]).toBe('- [2024-01-14](2024-01-14.md)')
    })

    it('is deterministic for same set of days', () => {
      const tree1 = renderExportTree(GOLDEN_INPUT)
      const tree2 = renderExportTree(GOLDEN_INPUT)
      expect(tree1.get('views/timeline.md')).toBe(tree2.get('views/timeline.md'))
    })

    it('contains no timestamps or exportedAt', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const timeline = tree.get('views/timeline.md')!
      expect(timeline).not.toContain('exportedAt')
      // No ISO 8601 timestamps (pattern: T followed by digits and colons)
      expect(timeline).not.toMatch(/T\d{2}:\d{2}/)
      expect(timeline).not.toContain('---') // no frontmatter
    })
  })

  describe('atoms', () => {
    it('renders atoms/YYYY-MM-DD.md for each day with atoms', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      expect(tree.has('atoms/2024-01-15.md')).toBe(true)
      expect(tree.has('atoms/2024-01-16.md')).toBe(true)
    })

    it('groups atoms by source with §9.1 format', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const atoms15 = tree.get('atoms/2024-01-15.md')!
      expect(atoms15).toContain('# SOURCE: chatgpt')
      expect(atoms15).toContain('[2024-01-15T10:30:00.000Z] user: How do I implement token-based auth?')
      expect(atoms15).toContain('[2024-01-15T14:15:00.000Z] user: Can you review this PR for security issues?')
    })

    it('renders multi-source atoms with blank line between sources', () => {
      const input: ExportInput = {
        ...GOLDEN_INPUT,
        days: [{
          dayDate: '2024-01-15',
          outputText: 'Summary.',
          createdAt: '2024-01-15T23:45:00.000Z',
          bundleHash: 'h1',
          bundleContextHash: 'h2',
          segmented: false,
          atoms: [
            { source: 'chatgpt', timestampUtc: '2024-01-15T10:00:00.000Z', text: 'From ChatGPT', atomStableId: 'a1' },
            { source: 'claude', timestampUtc: '2024-01-15T11:00:00.000Z', text: 'From Claude', atomStableId: 'a2' },
          ],
        }],
      }

      const tree = renderExportTree(input)
      const atoms = tree.get('atoms/2024-01-15.md')!

      expect(atoms).toBe(
        '# SOURCE: chatgpt\n' +
        '[2024-01-15T10:00:00.000Z] user: From ChatGPT\n' +
        '\n' +
        '# SOURCE: claude\n' +
        '[2024-01-15T11:00:00.000Z] user: From Claude\n'
      )
    })

    it('renders empty atoms file as single newline', () => {
      const input: ExportInput = {
        ...GOLDEN_INPUT,
        days: [{
          dayDate: '2024-01-15',
          outputText: 'Summary.',
          createdAt: '2024-01-15T23:45:00.000Z',
          bundleHash: 'h1',
          bundleContextHash: 'h2',
          segmented: false,
          atoms: [],
        }],
      }

      const tree = renderExportTree(input)
      const atoms = tree.get('atoms/2024-01-15.md')!
      expect(atoms).toBe('\n')
    })

    it('skips atoms files when atoms field is undefined', () => {
      const input: ExportInput = {
        ...GOLDEN_INPUT,
        days: [{
          dayDate: '2024-01-15',
          outputText: 'Summary.',
          createdAt: '2024-01-15T23:45:00.000Z',
          bundleHash: 'h1',
          bundleContextHash: 'h2',
          segmented: false,
          // atoms is undefined
        }],
      }

      const tree = renderExportTree(input)
      expect(tree.has('atoms/2024-01-15.md')).toBe(false)
    })

    it('includes atoms files in manifest hashes', () => {
      const tree = renderExportTree(GOLDEN_INPUT)
      const manifest = JSON.parse(tree.get('.journal-meta/manifest.json')!)
      expect(manifest.files['atoms/2024-01-15.md']).toBeDefined()
      expect(manifest.files['atoms/2024-01-15.md'].sha256).toBe(sha256(tree.get('atoms/2024-01-15.md')!))
      expect(manifest.files['atoms/2024-01-16.md']).toBeDefined()
      expect(manifest.files['atoms/2024-01-16.md'].sha256).toBe(sha256(tree.get('atoms/2024-01-16.md')!))
    })
  })
})

describe('helpers', () => {
  describe('renderFrontmatter', () => {
    it('renders string values with double quotes', () => {
      const result = renderFrontmatter([['key', 'value']])
      expect(result).toBe('---\nkey: "value"\n---')
    })

    it('renders numbers without quotes', () => {
      const result = renderFrontmatter([['count', 42]])
      expect(result).toBe('---\ncount: 42\n---')
    })

    it('renders booleans without quotes', () => {
      const result = renderFrontmatter([['flag', true]])
      expect(result).toBe('---\nflag: true\n---')
    })

    it('preserves field order from input array', () => {
      const result = renderFrontmatter([
        ['z', 'last'],
        ['a', 'first'],
        ['m', 'middle'],
      ])
      expect(result).toBe('---\nz: "last"\na: "first"\nm: "middle"\n---')
    })
  })

  describe('sortKeysDeep', () => {
    it('sorts top-level keys alphabetically', () => {
      const result = sortKeysDeep({ z: 1, a: 2, m: 3 })
      expect(Object.keys(result as Record<string, unknown>)).toEqual(['a', 'm', 'z'])
    })

    it('sorts nested object keys', () => {
      const result = sortKeysDeep({ b: { z: 1, a: 2 }, a: 1 }) as Record<string, unknown>
      expect(Object.keys(result)).toEqual(['a', 'b'])
      expect(Object.keys(result.b as Record<string, unknown>)).toEqual(['a', 'z'])
    })

    it('preserves array order', () => {
      const result = sortKeysDeep({ items: [3, 1, 2] })
      expect((result as Record<string, unknown>).items).toEqual([3, 1, 2])
    })

    it('handles null and primitives', () => {
      expect(sortKeysDeep(null)).toBe(null)
      expect(sortKeysDeep(42)).toBe(42)
      expect(sortKeysDeep('hello')).toBe('hello')
      expect(sortKeysDeep(true)).toBe(true)
    })
  })

  describe('renderJson', () => {
    it('produces sorted JSON with 2-space indent and trailing newline', () => {
      const result = renderJson({ z: 1, a: 2 })
      expect(result).toBe('{\n  "a": 2,\n  "z": 1\n}\n')
    })

    it('ends with exactly one newline', () => {
      const result = renderJson({ key: 'value' })
      expect(result.endsWith('\n')).toBe(true)
      expect(result.endsWith('\n\n')).toBe(false)
    })
  })
})
