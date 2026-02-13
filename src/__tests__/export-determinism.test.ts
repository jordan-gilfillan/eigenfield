/**
 * CI determinism guard for export output
 *
 * AUD-069: Exports the same ExportInput twice and asserts byte-identical
 * output across all file types (README, day views, timeline, manifest).
 * Guards against accidental non-determinism in the renderer (locale,
 * timezone, floating-point, Map iteration order, etc.).
 *
 * Spec reference: §14.4 (determinism contract)
 */

import { describe, it, expect } from 'vitest'
import { renderExportTree } from '../lib/export/renderer'
import { sha256 } from '../lib/hash'
import type { ExportInput } from '../lib/export/types'

// Representative input: 3 days (1 segmented), 2 batches, mixed content
const DETERMINISM_INPUT: ExportInput = {
  run: {
    id: 'det-run-001',
    model: 'gpt-4o-mini',
    startDate: '2025-03-10',
    endDate: '2025-03-12',
    sources: ['chatgpt', 'claude'],
    timezone: 'Europe/Berlin',
    filterProfile: { name: 'work-filter', mode: 'include', categories: ['work', 'learning', 'health'] },
  },
  batches: [
    {
      id: 'det-batch-chatgpt',
      source: 'chatgpt',
      originalFilename: 'conversations.json',
      timezone: 'Europe/Berlin',
    },
    {
      id: 'det-batch-claude',
      source: 'claude',
      originalFilename: 'claude-export.json',
      timezone: 'Europe/Berlin',
    },
  ],
  days: [
    {
      dayDate: '2025-03-10',
      outputText: 'Kicked off sprint planning. Reviewed backlog items with the team.\n\nDebugged a timezone issue in the date formatter.',
      createdAt: '2025-03-10T18:30:00.000Z',
      bundleHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      bundleContextHash: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2025-03-10T09:00:00.000Z', text: 'Sprint planning agenda items?', atomStableId: 'det-a1' },
        { source: 'chatgpt', timestampUtc: '2025-03-10T14:30:00.000Z', text: 'Debug this timezone issue in formatDate', atomStableId: 'det-a2' },
        { source: 'claude', timestampUtc: '2025-03-10T11:00:00.000Z', text: 'Review the backlog priorities', atomStableId: 'det-a3' },
      ],
    },
    {
      dayDate: '2025-03-11',
      outputText: 'Morning: pair programming on auth module.\n\nAfternoon: wrote integration tests for the export pipeline.\n\nEvening: read chapter 5 of "Designing Data-Intensive Applications".',
      createdAt: '2025-03-11T21:15:00.000Z',
      bundleHash: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
      bundleContextHash: 'e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4',
      segmented: true,
      segmentCount: 3,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2025-03-11T08:00:00.000Z', text: 'Pair on the auth module today', atomStableId: 'det-b1' },
        { source: 'chatgpt', timestampUtc: '2025-03-11T13:00:00.000Z', text: 'Write integration tests for export', atomStableId: 'det-b2' },
      ],
    },
    {
      dayDate: '2025-03-12',
      outputText: 'Deployed v2.1 to staging. Ran smoke tests — all green.',
      createdAt: '2025-03-12T16:00:00.000Z',
      bundleHash: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
      bundleContextHash: 'd4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3',
      segmented: false,
      atoms: [
        { source: 'chatgpt', timestampUtc: '2025-03-12T10:00:00.000Z', text: 'Deploy v2.1 to staging', atomStableId: 'det-c1' },
      ],
    },
  ],
  exportedAt: '2025-03-15T10:00:00.000Z',
}

describe('export determinism guard (AUD-069)', () => {
  it('two renders of the same input produce byte-identical output across all file types', () => {
    const tree1 = renderExportTree(DETERMINISM_INPUT)
    const tree2 = renderExportTree(DETERMINISM_INPUT)

    // Same file count
    expect(tree1.size).toBe(tree2.size)

    // Same file paths
    const paths1 = [...tree1.keys()].sort()
    const paths2 = [...tree2.keys()].sort()
    expect(paths1).toEqual(paths2)

    // Byte-identical content (compared via SHA-256)
    for (const path of paths1) {
      const hash1 = sha256(tree1.get(path)!)
      const hash2 = sha256(tree2.get(path)!)
      expect(hash2, `${path} content diverged between renders`).toBe(hash1)
    }
  })

  it('covers all required file types: README, views, timeline, atoms, sources, manifest', () => {
    const tree = renderExportTree(DETERMINISM_INPUT)
    const paths = [...tree.keys()]

    // README
    expect(paths).toContain('README.md')

    // Timeline
    expect(paths).toContain('views/timeline.md')

    // Day views (one per day in input)
    expect(paths).toContain('views/2025-03-10.md')
    expect(paths).toContain('views/2025-03-11.md')
    expect(paths).toContain('views/2025-03-12.md')

    // Atoms (one per day in input)
    expect(paths).toContain('atoms/2025-03-10.md')
    expect(paths).toContain('atoms/2025-03-11.md')
    expect(paths).toContain('atoms/2025-03-12.md')

    // Sources (one per batch in input)
    expect(paths).toContain('sources/chatgpt-conversations.md')
    expect(paths).toContain('sources/claude-claude-export.md')

    // Manifest
    expect(paths).toContain('.journal-meta/manifest.json')
  })

  it('manifest hashes are consistent with file contents on repeated renders', () => {
    const tree1 = renderExportTree(DETERMINISM_INPUT)
    const tree2 = renderExportTree(DETERMINISM_INPUT)

    const manifest1 = JSON.parse(tree1.get('.journal-meta/manifest.json')!)
    const manifest2 = JSON.parse(tree2.get('.journal-meta/manifest.json')!)

    // Manifest files section lists the same hashes
    expect(manifest1.files).toEqual(manifest2.files)

    // Each recorded hash matches actual content
    for (const [path, content] of tree1) {
      if (path === '.journal-meta/manifest.json') continue
      expect(manifest1.files[path].sha256, `manifest hash for ${path}`).toBe(sha256(content))
    }
  })
})
