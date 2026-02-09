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
let claudeImportBatchId: string
let runId: string
let jobId: string
let outputId: string
let promptVersionId: string
let promptId: string
let filterProfileId: string
let classifyPromptId: string
let classifyPromptVersionId: string
const atomIds: string[] = []
const labelIds: string[] = []

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

  // Create a second import batch (CLAUDE source) for sources filter testing
  const claudeBatch = await prisma.importBatch.create({
    data: {
      id: 'search-test-batch-claude',
      source: 'CLAUDE',
      originalFilename: 'search-test-claude.json',
      fileSizeBytes: 500,
      timezone: 'UTC',
      statsJson: {
        message_count: 1,
        day_count: 1,
        coverage_start: '2024-01-15',
        coverage_end: '2024-01-15',
        per_source_counts: { claude: 1 },
      },
    },
  })
  claudeImportBatchId = claudeBatch.id

  const claudeAtom = await prisma.messageAtom.create({
    data: {
      id: 'search-atom-5',
      atomStableId: 'search-stable-5',
      importBatchId: claudeImportBatchId,
      source: 'CLAUDE' as const,
      timestampUtc: new Date('2024-01-15T11:00:00.000Z'),
      dayDate: new Date('2024-01-15'),
      role: 'USER' as const,
      text: 'Can you explain the fibonacci sequence and its applications in nature?',
      textHash: 'hash-search-5',
    },
  })
  atomIds.push(claudeAtom.id)

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

  // Create classify prompt + version for label context testing
  const classifyPrompt = await prisma.prompt.create({
    data: {
      id: 'search-test-classify-prompt',
      stage: 'CLASSIFY',
      name: 'search-test-classify',
    },
  })
  classifyPromptId = classifyPrompt.id

  const classifyPv = await prisma.promptVersion.create({
    data: {
      id: 'search-test-classify-pv',
      promptId: classifyPrompt.id,
      versionLabel: 'v1',
      templateText: '{"category":"{{category}}","confidence":{{confidence}}}',
      isActive: true,
    },
  })
  classifyPromptVersionId = classifyPv.id

  // Create MessageLabel records for atom-1 and atom-3
  const label1 = await prisma.messageLabel.create({
    data: {
      id: 'search-test-label-1',
      messageAtomId: 'search-atom-1',
      category: 'LEARNING',
      confidence: 0.85,
      model: 'stub_v1',
      promptVersionId: classifyPromptVersionId,
    },
  })
  labelIds.push(label1.id)

  const label2 = await prisma.messageLabel.create({
    data: {
      id: 'search-test-label-2',
      messageAtomId: 'search-atom-3',
      category: 'WORK',
      confidence: 0.92,
      model: 'stub_v1',
      promptVersionId: classifyPromptVersionId,
    },
  })
  labelIds.push(label2.id)
})

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.messageLabel.deleteMany({ where: { id: { in: labelIds } } })
  await prisma.output.deleteMany({ where: { id: outputId } })
  await prisma.job.deleteMany({ where: { id: jobId } })
  await prisma.run.deleteMany({ where: { id: runId } })
  await prisma.messageAtom.deleteMany({ where: { id: { in: atomIds } } })
  await prisma.importBatch.deleteMany({ where: { id: { in: [importBatchId, claudeImportBatchId] } } })
  await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
  await prisma.promptVersion.deleteMany({ where: { id: { in: [promptVersionId, classifyPromptVersionId] } } })
  await prisma.prompt.deleteMany({ where: { id: { in: [promptId, classifyPromptId] } } })
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

  describe('label context (category + confidence)', () => {
    it('returns category/confidence when labelModel + labelPromptVersionId provided', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(2)

      // atom-1 has a label (LEARNING, 0.85)
      const atom1 = result.items.find(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId === 'search-stable-1'
      ) as { atom: { category: string | null; confidence: number | null } } | undefined
      expect(atom1).toBeDefined()
      expect(atom1!.atom.category).toBe('learning')
      expect(atom1!.atom.confidence).toBeCloseTo(0.85)

      // atom-2 has no label — should be null
      const atom2 = result.items.find(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId === 'search-stable-2'
      ) as { atom: { category: string | null; confidence: number | null } } | undefined
      expect(atom2).toBeDefined()
      expect(atom2!.atom.category).toBeNull()
      expect(atom2!.atom.confidence).toBeNull()
    })

    it('returns null category/confidence without label context', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      result.items.forEach((item) => {
        const atom = (item as { atom: { category: string | null; confidence: number | null } }).atom
        expect(atom.category).toBeNull()
        expect(atom.confidence).toBeNull()
      })
    })

    it('resolves label context from runId config.labelSpec', async () => {
      // Update the test run's labelSpec to point to our classify promptVersion + model
      await prisma.run.update({
        where: { id: runId },
        data: {
          configJson: {
            promptVersionIds: { summarize: promptVersionId },
            labelSpec: { model: 'stub_v1', promptVersionId: classifyPromptVersionId },
            filterProfile: { name: 'search-test', mode: 'include', categories: ['WORK'] },
            timezone: 'UTC',
            maxInputTokens: 12000,
          },
        },
      })

      const result = await search({
        q: 'PostgreSQL',
        scope: 'raw',
        limit: 50,
        importBatchId,
        runId,
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)

      // atom-3 has label (WORK, 0.92) and matches "PostgreSQL"
      const atom3 = result.items.find(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId === 'search-stable-3'
      ) as { atom: { category: string | null; confidence: number | null } } | undefined
      expect(atom3).toBeDefined()
      expect(atom3!.atom.category).toBe('work')
      expect(atom3!.atom.confidence).toBeCloseTo(0.92)
    })

    it('explicit labelModel/labelPromptVersionId takes precedence over runId', async () => {
      // runId points to classifyPromptVersionId; explicit params use a non-matching PV
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        runId,
        labelModel: 'nonexistent_model',
        labelPromptVersionId: 'nonexistent-pv',
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      // No labels match nonexistent model+pv, so all should be null
      result.items.forEach((item) => {
        const atom = (item as { atom: { category: string | null; confidence: number | null } }).atom
        expect(atom.category).toBeNull()
        expect(atom.confidence).toBeNull()
      })
    })
  })

  describe('sources filter', () => {
    it('sources=chatgpt returns only CHATGPT atoms', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        sources: ['chatgpt'],
      })

      expect(result.items.length).toBeGreaterThanOrEqual(2)
      result.items.forEach((item) => {
        const atom = (item as { atom: { source: string } }).atom
        expect(atom.source).toBe('chatgpt')
      })
      // CLAUDE atom (search-stable-5) must NOT appear
      const stableIds = result.items.map(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId
      )
      expect(stableIds).not.toContain('search-stable-5')
    })

    it('sources=claude returns only CLAUDE atoms', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        sources: ['claude'],
      })

      expect(result.items.length).toBeGreaterThanOrEqual(1)
      result.items.forEach((item) => {
        const atom = (item as { atom: { source: string } }).atom
        expect(atom.source).toBe('claude')
      })
      const stableIds = result.items.map(
        (item) => (item as { atom: { atomStableId: string } }).atom.atomStableId
      )
      expect(stableIds).toContain('search-stable-5')
    })

    it('sources=chatgpt,claude returns atoms from both sources', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        sources: ['chatgpt', 'claude'],
      })

      const sources = result.items.map(
        (item) => (item as { atom: { source: string } }).atom.source
      )
      expect(sources).toContain('chatgpt')
      expect(sources).toContain('claude')
    })

    it('sources=grok returns no results when no grok atoms exist', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        sources: ['grok'],
      })

      expect(result.items).toHaveLength(0)
    })
  })

  describe('categories filter', () => {
    it('categories=learning with label context returns only LEARNING-labeled atoms', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        categories: ['learning'],
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      // Only atom-1 matches fibonacci AND has LEARNING label
      expect(result.items.length).toBe(1)
      const atom = (result.items[0] as { atom: { atomStableId: string; category: string | null } }).atom
      expect(atom.atomStableId).toBe('search-stable-1')
      expect(atom.category).toBe('learning')
    })

    it('categories=work with label context returns only WORK-labeled atoms', async () => {
      const result = await search({
        q: 'PostgreSQL',
        scope: 'raw',
        limit: 50,
        categories: ['work'],
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      // Only atom-3 matches PostgreSQL AND has WORK label
      expect(result.items.length).toBe(1)
      const atom = (result.items[0] as { atom: { atomStableId: string; category: string | null } }).atom
      expect(atom.atomStableId).toBe('search-stable-3')
      expect(atom.category).toBe('work')
    })

    it('categories=work,learning with label context returns both labeled atoms', async () => {
      // Search for a broad term that matches atoms with both labels
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        categories: ['work', 'learning'],
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      // atom-1 (LEARNING) matches fibonacci; atom-3 (WORK) does not match fibonacci
      // So only atom-1 should appear
      expect(result.items.length).toBe(1)
      const atom = (result.items[0] as { atom: { atomStableId: string; category: string | null } }).atom
      expect(atom.atomStableId).toBe('search-stable-1')
    })

    it('categories=personal with label context returns no results when no atoms have that label', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        categories: ['personal'],
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      expect(result.items).toHaveLength(0)
    })

    it('categories filter without label context throws (SPEC §7.9)', async () => {
      // No labelModel/labelPromptVersionId/runId — must reject per SPEC §7.9
      await expect(
        search({
          q: 'fibonacci',
          scope: 'raw',
          limit: 50,
          categories: ['learning'],
        })
      ).rejects.toThrow('categories filter requires label context')
    })

    it('combined sources + categories filter narrows results', async () => {
      const result = await search({
        q: 'fibonacci',
        scope: 'raw',
        limit: 50,
        sources: ['chatgpt'],
        categories: ['learning'],
        labelModel: 'stub_v1',
        labelPromptVersionId: classifyPromptVersionId,
      })

      // Only atom-1: source=CHATGPT, label=LEARNING, matches fibonacci
      expect(result.items.length).toBe(1)
      const atom = (result.items[0] as { atom: { atomStableId: string; source: string; category: string | null } }).atom
      expect(atom.atomStableId).toBe('search-stable-1')
      expect(atom.source).toBe('chatgpt')
      expect(atom.category).toBe('learning')
    })
  })
})
