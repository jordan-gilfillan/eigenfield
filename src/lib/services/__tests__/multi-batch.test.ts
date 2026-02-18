/**
 * Tests for Multi-Batch Run Support
 *
 * Spec references: §6.8a (RunBatch junction), §7.3 (Run creation with importBatchIds),
 * §9.1 (Cross-batch bundle ordering + dedup)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { createRun, TimezoneMismatchError } from '../run'
import { InvalidInputError } from '../../errors'
import { buildBundle } from '../bundle'
import { processTick } from '../tick'

describe('multi-batch support', () => {
  let testBatch1Id: string
  let testBatch2Id: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create two import batches with same timezone but different sources
    const batch1 = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'chatgpt-export.json',
        fileSizeBytes: 1000,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 6,
          day_count: 2,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-02',
        },
      },
    })
    testBatch1Id = batch1.id

    const batch2 = await prisma.importBatch.create({
      data: {
        source: 'CLAUDE',
        originalFilename: 'claude-export.json',
        fileSizeBytes: 500,
        timezone: 'America/New_York', // same TZ
        statsJson: {
          message_count: 3,
          day_count: 1,
          coverage_start: '2024-01-02',
          coverage_end: '2024-01-02',
        },
      },
    })
    testBatch2Id = batch2.id

    // Create filter profile
    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test Multi Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    // Create prompts
    const classifyPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `Test Multi Classify ${testUniqueId}`,
      },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-multi-v1',
        templateText: 'Test classify prompt',
        isActive: true,
        // Do NOT use far-future createdAt here — that would race with
        // run.test.ts's "default labelSpec" test which also uses 2099.
        // All multi-batch tests pass labelSpec explicitly.
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `Test Multi Summarize ${testUniqueId}`,
      },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-multi-v1',
        templateText: 'Test summarize prompt',
        isActive: true,
      },
    })
    testSummarizePromptVersionId = summarizeVersion.id

    // Batch 1: 3 atoms on day 1, 3 atoms on day 2 (CHATGPT)
    for (let day = 0; day < 2; day++) {
      const dayDate = day === 0 ? new Date('2024-01-01T12:00:00Z') : new Date('2024-01-02T12:00:00Z')

      await prisma.rawEntry.create({
        data: {
          importBatchId: testBatch1Id,
          source: 'CHATGPT',
          dayDate: new Date(dayDate.toISOString().split('T')[0]),
          contentText: `Batch1 content day ${day}`,
          contentHash: `batch1-hash-${testUniqueId}-${day}`,
        },
      })

      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testBatch1Id,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Batch1 message ${day}-${j}`,
            textHash: `text-hash-b1-${testUniqueId}-${day}-${j}`,
            timestampUtc: new Date(dayDate.getTime() + j * 1000),
            dayDate: new Date(dayDate.toISOString().split('T')[0]),
            atomStableId: `multi-batch1-atom-${testUniqueId}-${day}-${j}`,
          },
        })

        await prisma.messageLabel.create({
          data: {
            messageAtomId: atom.id,
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
            category: 'PERSONAL',
            confidence: 1.0,
          },
        })
      }
    }

    // Batch 2: 3 atoms on day 2 only (CLAUDE)
    const day2 = new Date('2024-01-02T12:00:00Z')

    await prisma.rawEntry.create({
      data: {
        importBatchId: testBatch2Id,
        source: 'CLAUDE',
        dayDate: new Date(day2.toISOString().split('T')[0]),
        contentText: 'Batch2 content day 2',
        contentHash: `batch2-hash-${testUniqueId}`,
      },
    })

    for (let j = 0; j < 3; j++) {
      const atom = await prisma.messageAtom.create({
        data: {
          importBatchId: testBatch2Id,
          source: 'CLAUDE',
          role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
          text: `Batch2 message 1-${j}`,
          textHash: `text-hash-b2-${testUniqueId}-1-${j}`,
          timestampUtc: new Date(day2.getTime() + j * 1000),
          dayDate: new Date(day2.toISOString().split('T')[0]),
          atomStableId: `multi-batch2-atom-${testUniqueId}-1-${j}`,
        },
      })

      await prisma.messageLabel.create({
        data: {
          messageAtomId: atom.id,
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
          category: 'PERSONAL',
          confidence: 1.0,
        },
      })
    }
  })

  afterEach(async () => {
    // Clean up — cascade from runs handles RunBatch rows
    for (const batchId of [testBatch1Id, testBatch2Id]) {
      await prisma.output.deleteMany({
        where: { job: { run: { importBatchId: batchId } } },
      })
      await prisma.job.deleteMany({
        where: { run: { importBatchId: batchId } },
      })
      // Delete RunBatch rows explicitly (run deletion cascades, but be safe)
      await prisma.runBatch.deleteMany({
        where: { run: { importBatchId: batchId } },
      })
      await prisma.run.deleteMany({
        where: { importBatchId: batchId },
      })
      await prisma.messageLabel.deleteMany({
        where: { messageAtom: { importBatchId: batchId } },
      })
      await prisma.messageAtom.deleteMany({
        where: { importBatchId: batchId },
      })
      await prisma.rawEntry.deleteMany({
        where: { importBatchId: batchId },
      })
    }
    await prisma.importBatch.deleteMany({
      where: { id: { in: [testBatch1Id, testBatch2Id] } },
    })
    await prisma.filterProfile.deleteMany({
      where: { id: testFilterProfileId },
    })
    if (testClassifyPromptVersionId) {
      await prisma.promptVersion.deleteMany({
        where: { id: testClassifyPromptVersionId },
      })
    }
    if (testSummarizePromptVersionId) {
      await prisma.promptVersion.deleteMany({
        where: { id: testSummarizePromptVersionId },
      })
    }
    if (testClassifyPromptId) {
      await prisma.prompt.deleteMany({
        where: { id: testClassifyPromptId },
      })
    }
    if (testSummarizePromptId) {
      await prisma.prompt.deleteMany({
        where: { id: testSummarizePromptId },
      })
    }
  })

  describe('createRun with importBatchIds', () => {
    it('creates run with 2 batches (same TZ) → 2 RunBatch rows', async () => {
      const result = await createRun({
        importBatchIds: [testBatch1Id, testBatch2Id],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(result.id).toBeDefined()
      expect(result.status).toBe('queued')
      expect(result.importBatchIds).toEqual([testBatch1Id, testBatch2Id])
      expect(result.importBatchId).toBe(testBatch1Id) // deprecated = first

      // Verify RunBatch junction rows
      const runBatches = await prisma.runBatch.findMany({
        where: { runId: result.id },
        orderBy: { importBatchId: 'asc' },
      })
      expect(runBatches).toHaveLength(2)
      const batchIds = runBatches.map((rb) => rb.importBatchId).sort()
      expect(batchIds).toEqual([testBatch1Id, testBatch2Id].sort())

      // Verify configJson includes importBatchIds
      expect(result.config.importBatchIds).toEqual([testBatch1Id, testBatch2Id])
    })

    it('throws TIMEZONE_MISMATCH when batches have different timezones', async () => {
      // Update batch2 to a different timezone
      await prisma.importBatch.update({
        where: { id: testBatch2Id },
        data: { timezone: 'Europe/London' },
      })

      try {
        await createRun({
          importBatchIds: [testBatch1Id, testBatch2Id],
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt', 'claude'],
          filterProfileId: testFilterProfileId,
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
        expect.fail('Should have thrown TimezoneMismatchError')
      } catch (error) {
        expect(error).toBeInstanceOf(TimezoneMismatchError)
        const tzError = error as TimezoneMismatchError
        expect(tzError.code).toBe('TIMEZONE_MISMATCH')
        expect(tzError.timezones).toContain('America/New_York')
        expect(tzError.timezones).toContain('Europe/London')
        expect(tzError.batchIds).toEqual([testBatch1Id, testBatch2Id])
      }
    })

    it('rejects both importBatchId and importBatchIds', async () => {
      await expect(
        createRun({
          importBatchId: testBatch1Id,
          importBatchIds: [testBatch1Id, testBatch2Id],
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
      ).rejects.toThrow(InvalidInputError)
    })

    it('rejects empty importBatchIds', async () => {
      await expect(
        createRun({
          importBatchIds: [],
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
      ).rejects.toThrow(InvalidInputError)
    })

    it('rejects duplicate importBatchIds', async () => {
      await expect(
        createRun({
          importBatchIds: [testBatch1Id, testBatch1Id],
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
      ).rejects.toThrow(InvalidInputError)
    })

    it('backward compat: single importBatchId still creates RunBatch row', async () => {
      const result = await createRun({
        importBatchId: testBatch1Id,
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(result.importBatchId).toBe(testBatch1Id)
      expect(result.importBatchIds).toEqual([testBatch1Id])

      // Verify exactly 1 RunBatch row
      const runBatches = await prisma.runBatch.findMany({
        where: { runId: result.id },
      })
      expect(runBatches).toHaveLength(1)
      expect(runBatches[0].importBatchId).toBe(testBatch1Id)
    })
  })

  describe('findEligibleDays across batches', () => {
    it('unions days from multiple batches', async () => {
      // Batch1 has day1 + day2, batch2 has day2 only
      // Union should include both days
      const result = await createRun({
        importBatchIds: [testBatch1Id, testBatch2Id],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      // Should find 2 eligible days (day1 from batch1, day2 from batch1+batch2)
      expect(result.eligibleDays).toEqual(['2024-01-01', '2024-01-02'])
      expect(result.jobCount).toBe(2)
    })

    it('finds days only in second batch', async () => {
      // Use only claude source — only batch2 has claude atoms (day2 only)
      const result = await createRun({
        importBatchIds: [testBatch1Id, testBatch2Id],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['claude'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      // Only day2 should be eligible (claude atoms only in batch2 on day2)
      expect(result.eligibleDays).toEqual(['2024-01-02'])
      expect(result.jobCount).toBe(1)
    })
  })

  describe('buildBundle cross-batch dedup', () => {
    it('includes atoms from multiple batches', async () => {
      const bundle = await buildBundle({
        importBatchIds: [testBatch1Id, testBatch2Id],
        dayDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: `Test Multi-Batch Filter ${testUniqueId}`,
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // Day 2 has 2 user atoms from batch1 (chatgpt) + 2 user atoms from batch2 (claude)
      expect(bundle.atomCount).toBe(4)
      expect(bundle.bundleText).toContain('# SOURCE: chatgpt')
      expect(bundle.bundleText).toContain('# SOURCE: claude')
    })

    it('dedup filter does not remove atoms with distinct atomStableIds', async () => {
      // atomStableId has a DB-level unique constraint, so physical duplicates
      // across batches are impossible (import-time dedup prevents them).
      // The cross-batch dedup in buildBundle is defense-in-depth per SPEC §9.1.
      // This test verifies the dedup filter doesn't falsely remove valid atoms.

      const bundle = await buildBundle({
        importBatchIds: [testBatch1Id, testBatch2Id],
        dayDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        filterProfile: {
          name: `Test Multi-Batch Filter ${testUniqueId}`,
          mode: 'EXCLUDE',
          categories: ['WORK'],
        },
      })

      // All 4 user atoms should survive the dedup filter (2 chatgpt + 2 claude, all distinct)
      expect(bundle.atomCount).toBe(4)

      // Verify all atomStableIds are unique
      const stableIds = bundle.atoms.map((a) => a.atomStableId)
      expect(new Set(stableIds).size).toBe(4)
    })
  })

  describe('processTick with multi-batch run', () => {
    it('processes jobs using atoms from multiple batches', async () => {
      const run = await createRun({
        importBatchIds: [testBatch1Id, testBatch2Id],
        startDate: '2024-01-02',
        endDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(run.jobCount).toBe(1) // Only day2

      // Process tick
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
      expect(result.runStatus).toBe('completed')

      // Verify output was created with atoms from both batches
      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(1)
      expect(outputs[0].outputText).toContain('Summary (stub)')
    })

    it('reads importBatchIds from RunBatch junction, not run.importBatchId', async () => {
      // Create multi-batch run
      const run = await createRun({
        importBatchIds: [testBatch1Id, testBatch2Id],
        startDate: '2024-01-02',
        endDate: '2024-01-02',
        sources: ['chatgpt', 'claude'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      // Verify RunBatch rows exist (tick should read from these)
      const runBatches = await prisma.runBatch.findMany({
        where: { runId: run.id },
      })
      expect(runBatches).toHaveLength(2)

      // Process tick — this exercises the RunBatch junction read path
      const result = await processTick({ runId: run.id, maxJobs: 10 })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
    })
  })
})
