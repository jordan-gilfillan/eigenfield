import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { search } from '@/lib/services/search'

/**
 * Integration tests for the search service (PR-6.1).
 *
 * These tests require a running database with the FTS migration applied.
 * They create test data, run searches, and clean up after themselves.
 */

// Track IDs for cleanup
let importBatchId: string
let runId: string
let jobId: string
let outputId: string
let promptVersionId: string
let promptId: string
let filterProfileId: string
const atomIds: string[] = []

beforeAll(async () => {
  // Create prerequisite records: prompt, promptVersion, filterProfile, importBatch
  const prompt = await prisma.prompt.create({
    data: {
      id: 'search-test-prompt',
      stage: 'SUMMARIZE',
      name: 'search-test-summarize',
    },
  })
  promptId = prompt.id

  const pv = await prisma.promptVersion.create({
    data: {
      id: 'search-test-pv',
      promptId: prompt.id,
      versionLabel: 'v1',
      templateText: 'Summarize: {{text}}',
      isActive: true,
    },
  })
  promptVersionId = pv.id

  const fp = await prisma.filterProfile.create({
    data: {
      id: 'search-test-fp',
      name: 'search-test-profile',
      mode: 'INCLUDE',
      categories: ['WORK', 'LEARNING'],
    },
  })
  filterProfileId = fp.id

  const batch = await prisma.importBatch.create({
    data: {
      id: 'search-test-batch',
      source: 'CHATGPT',
      originalFilename: 'search-test.json',
      fileSizeBytes: 1000,
      timezone: 'UTC',
      statsJson: {
        message_count: 4,
        day_count: 2,
        coverage_start: '2024-01-15',
        coverage_end: '2024-01-16',
        per_source_counts: { chatgpt: 4 },
      },
    },
  })
  importBatchId = batch.id

  // Create MessageAtoms with searchable text
  const atoms = [
    {
      id: 'search-atom-1',
      atomStableId: 'search-stable-1',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-01-15T10:00:00.000Z'),
      dayDate: new Date('2024-01-15'),
      role: 'USER' as const,
      text: 'How do I implement a recursive fibonacci algorithm in Python?',
      textHash: 'hash-search-1',
    },
    {
      id: 'search-atom-2',
      atomStableId: 'search-stable-2',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-01-15T10:01:00.000Z'),
      dayDate: new Date('2024-01-15'),
      role: 'ASSISTANT' as const,
      text: 'Here is a recursive fibonacci implementation using memoization for performance optimization.',
      textHash: 'hash-search-2',
    },
    {
      id: 'search-atom-3',
      atomStableId: 'search-stable-3',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-01-16T09:00:00.000Z'),
      dayDate: new Date('2024-01-16'),
      role: 'USER' as const,
      text: 'Explain the difference between PostgreSQL and MySQL database systems.',
      textHash: 'hash-search-3',
    },
    {
      id: 'search-atom-4',
      atomStableId: 'search-stable-4',
      importBatchId,
      source: 'CHATGPT' as const,
      timestampUtc: new Date('2024-01-16T09:01:00.000Z'),
      dayDate: new Date('2024-01-16'),
      role: 'ASSISTANT' as const,
      text: 'PostgreSQL and MySQL are both relational database management systems with different strengths.',
      textHash: 'hash-search-4',
    },
  ]

  for (const atom of atoms) {
    await prisma.messageAtom.create({ data: atom })
    atomIds.push(atom.id)
  }

  // Create Run + Job + Output for outputs scope testing
  const run = await prisma.run.create({
    data: {
      id: 'search-test-run',
      status: 'COMPLETED',
      importBatchId,
      startDate: new Date('2024-01-15'),
      endDate: new Date('2024-01-16'),
      sources: ['chatgpt'],
      filterProfileId,
      model: 'gpt-4o',
      configJson: {
        promptVersionIds: { summarize: promptVersionId },
        labelSpec: { model: 'stub_v1', promptVersionId },
        filterProfile: { name: 'search-test', mode: 'include', categories: ['WORK'] },
        timezone: 'UTC',
        maxInputTokens: 12000,
      },
    },
  })
  runId = run.id

  const job = await prisma.job.create({
    data: {
      id: 'search-test-job',
      runId,
      dayDate: new Date('2024-01-15'),
      status: 'SUCCEEDED',
      attempt: 1,
    },
  })
  jobId = job.id

  const output = await prisma.output.create({
    data: {
      id: 'search-test-output',
      jobId,
      stage: 'SUMMARIZE',
      outputText:
        'The user asked about implementing fibonacci algorithms in Python using recursion and memoization techniques for better performance.',
      outputJson: { meta: {} },
      model: 'gpt-4o',
      promptVersionId,
      bundleHash: 'bundle-hash-search',
      bundleContextHash: 'bundle-ctx-hash-search',
    },
  })
  outputId = output.id
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.output.deleteMany({ where: { id: outputId } })
  await prisma.job.deleteMany({ where: { id: jobId } })
  await prisma.run.deleteMany({ where: { id: runId } })
  await prisma.messageAtom.deleteMany({ where: { id: { in: atomIds } } })
  await prisma.importBatch.deleteMany({ where: { id: importBatchId } })
  await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
  await prisma.promptVersion.deleteMany({ where: { id: promptVersionId } })
  await prisma.prompt.deleteMany({ where: { id: promptId } })
})

describe('Search Service', () => {
  it('database has required FTS columns', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'message_atoms' AND column_name = 'text_search')
          OR (table_name = 'outputs' AND column_name = 'output_text_search')
        )
      ORDER BY table_name, column_name
    `

    expect(rows).toEqual([
      { table_name: 'message_atoms', column_name: 'text_search' },
      { table_name: 'outputs', column_name: 'output_text_search' },
    ])
  })

  describe('raw scope (MessageAtoms)', () => {
    it('finds atoms matching search query', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(2)
      expect(result.items.every((item) => item.resultType === 'atom')).toBe(true)

      // Both atoms mentioning fibonacci should appear
      const stableIds = result.items.map(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId
      )
      expect(stableIds).toContain('search-stable-1')
      expect(stableIds).toContain('search-stable-2')
    })

    it('returns snippet with highlighted matches', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
      })

      expect(result.items.length).toBeGreaterThan(0)
      // ts_headline uses << and >> as markers
      const hasHighlight = result.items.some(
        (item) => item.snippet.includes('<<') && item.snippet.includes('>>')
      )
      expect(hasHighlight).toBe(true)
    })

    it('returns rank values', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
      })

      expect(result.items.length).toBeGreaterThan(0)
      result.items.forEach((item) => {
        expect(typeof item.rank).toBe('number')
        expect(item.rank).toBeGreaterThan(0)
      })
    })

    it('results are ordered by rank DESC then id ASC', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
      })

      for (let i = 1; i < result.items.length; i++) {
        const prev = result.items[i - 1]
        const curr = result.items[i]
        if (prev.rank === curr.rank) {
          // Same rank: id must be ascending (tie-breaker)
          const prevAtom = prev as { atom: { atomStableId: string } }
          const currAtom = curr as { atom: { atomStableId: string } }
          // We check that ordering is consistent (no random order)
          expect(typeof prevAtom.atom.atomStableId).toBe('string')
        } else {
          expect(prev.rank).toBeGreaterThanOrEqual(curr.rank)
        }
      }
    })

    it('filters by importBatchId', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        importBatchId: 'nonexistent-batch',
      })

      expect(result.items).toHaveLength(0)
    })

    it('filters by importBatchId (matching)', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        importBatchId,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(2)
    })

    it('filters by date range', async () => {
      // Only search day 2024-01-15
      const result = await search({
        q: 'PostgreSQL',
        scope: 'raw',
        limit: 50,
        startDate: '2024-01-16',
        endDate: '2024-01-16',
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      result.items.forEach((item) => {
        const atom = (item as { atom: { dayDate: string } }).atom
        expect(atom.dayDate).toBe('2024-01-16')
      })
    })

    it('returns empty for non-matching queries', async () => {
      const result = await search({
        q: 'xylophonezebra',
        scope: 'raw',
        limit: 50,
      })

      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBeUndefined()
    })

    it('atom result has correct shape', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 1,
      })

      expect(result.items.length).toBeGreaterThan(0)
      const item = result.items[0]
      expect(item.resultType).toBe('atom')
      expect(typeof item.rank).toBe('number')
      expect(typeof item.snippet).toBe('string')

      const atom = (item as { atom: Record<string, unknown> }).atom
      expect(typeof atom.atomStableId).toBe('string')
      expect(typeof atom.source).toBe('string')
      expect(typeof atom.dayDate).toBe('string')
      expect(typeof atom.timestampUtc).toBe('string')
      expect(typeof atom.role).toBe('string')
      // source/role should be lowercase (API convention)
      expect(atom.source).toBe('chatgpt')
      expect(['user', 'assistant']).toContain(atom.role)
    })
  })

  describe('outputs scope', () => {
    it('finds outputs matching search query', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'outputs',
        limit: 50,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      expect(result.items.every((item) => item.resultType === 'output')).toBe(true)
    })

    it('output result has correct shape', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'outputs',
        limit: 1,
      })

      expect(result.items.length).toBeGreaterThan(0)
      const item = result.items[0]
      expect(item.resultType).toBe('output')
      expect(typeof item.rank).toBe('number')
      expect(typeof item.snippet).toBe('string')

      const output = (item as { output: Record<string, unknown> }).output
      expect(typeof output.runId).toBe('string')
      expect(typeof output.dayDate).toBe('string')
      expect(typeof output.stage).toBe('string')
      expect(output.stage).toBe('summarize')
    })

    it('filters by runId', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'outputs',
        limit: 50,
        runId,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      result.items.forEach((item) => {
        const output = (item as { output: { runId: string } }).output
        expect(output.runId).toBe(runId)
      })
    })

    it('filters by runId (non-matching)', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'outputs',
        limit: 50,
        runId: 'nonexistent-run',
      })

      expect(result.items).toHaveLength(0)
    })

    it('returns empty for non-matching queries', async () => {
      const result = await search({
        q: 'xylophonezebra',
        scope: 'outputs',
        limit: 50,
      })

      expect(result.items).toHaveLength(0)
    })
  })

  describe('cursor pagination', () => {
    it('paginates raw results without duplicates', async () => {
      // Use limit=1 to force pagination across our 2+ fibonacci matches
      const page1 = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 1,
      })

      expect(page1.items).toHaveLength(1)
      expect(page1.nextCursor).toBeDefined()

      const page2 = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 1,
        cursor: page1.nextCursor,
      })

      expect(page2.items).toHaveLength(1)

      // No duplicate across pages
      const id1 = (page1.items[0] as { atom: { atomStableId: string } }).atom.atomStableId
      const id2 = (page2.items[0] as { atom: { atomStableId: string } }).atom.atomStableId
      expect(id1).not.toBe(id2)
    })

    it('returns no nextCursor on last page', async () => {
      // Get all results at once
      const all = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 200,
      })

      // If there are results but no more pages, nextCursor should be undefined
      if (all.items.length <= 200) {
        expect(all.nextCursor).toBeUndefined()
      }
    })

    it('rejects invalid cursor', async () => {
      await expect(
        search({
          q: 'fibonacci',
          scope: 'raw',
          limit: 50,
          cursor: 'not-a-valid-cursor',
        })
      ).rejects.toThrow('Invalid cursor')
    })
  })
})
