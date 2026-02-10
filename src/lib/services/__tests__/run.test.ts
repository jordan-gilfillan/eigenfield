/**
 * Tests for Run Service
 *
 * Spec references: 7.3 (Create run), 7.9 (Response format)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { createRun } from '../run'

describe('run service', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    // Generate unique suffix for this test run to avoid conflicts
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create test import batch
    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-conversations.json',
        fileSizeBytes: 1000,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 10,
          day_count: 2,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-02',
        },
      },
    })
    testImportBatchId = importBatch.id

    // Create test filter profile with unique name
    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    // Create test prompts and versions with unique names
    const classifyPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `Test Classify Prompt ${testUniqueId}`,
      },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-v1',
        templateText: 'Test classify prompt',
        isActive: true,
        // Far-future createdAt ensures this version always wins the
        // createRun default selection (findFirst orderBy createdAt desc),
        // preventing race conditions with parallel test files.
        createdAt: new Date('2099-01-01T00:00:00Z'),
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `Test Summarize Prompt ${testUniqueId}`,
      },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-v1',
        templateText: 'Test summarize prompt',
        isActive: true,
      },
    })
    testSummarizePromptVersionId = summarizeVersion.id

    // Create test message atoms with labels for 2 days
    const day1 = new Date('2024-01-01T12:00:00Z')
    const day2 = new Date('2024-01-02T12:00:00Z')

    for (let i = 0; i < 2; i++) {
      const dayDate = i === 0 ? day1 : day2
      const rawEntry = await prisma.rawEntry.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          dayDate: new Date(dayDate.toISOString().split('T')[0]),
          contentText: `Test content for day ${i}`,
          contentHash: `test-hash-${testUniqueId}-${i}`,
        },
      })

      // Create atoms for each day (3 per day)
      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Test message ${i}-${j}`,
            textHash: `text-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(dayDate.getTime() + j * 1000),
            dayDate: new Date(dayDate.toISOString().split('T')[0]),
            atomStableId: `test-run-atom-${testUniqueId}-${i}-${j}`,
          },
        })

        // Create label with category that passes filter (not 'coding')
        await prisma.messageLabel.create({
          data: {
            messageAtomId: atom.id,
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
            category: 'PERSONAL', confidence: 1.0, // Will pass EXCLUDE 'coding' filter
          },
        })
      }
    }
  })

  afterEach(async () => {
    // Clean up in correct order - use IDs we know exist
    await prisma.output.deleteMany({
      where: { job: { run: { importBatchId: testImportBatchId } } },
    })
    await prisma.job.deleteMany({
      where: { run: { importBatchId: testImportBatchId } },
    })
    await prisma.run.deleteMany({
      where: { importBatchId: testImportBatchId },
    })
    await prisma.messageLabel.deleteMany({
      where: { messageAtom: { importBatchId: testImportBatchId } },
    })
    await prisma.messageAtom.deleteMany({
      where: { importBatchId: testImportBatchId },
    })
    await prisma.rawEntry.deleteMany({
      where: { importBatchId: testImportBatchId },
    })
    await prisma.importBatch.deleteMany({
      where: { id: testImportBatchId },
    })
    await prisma.filterProfile.deleteMany({
      where: { id: testFilterProfileId },
    })
    // Delete prompt versions before prompts (foreign key)
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

  describe('createRun', () => {
    it('creates a run with frozen config and jobs for eligible days', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
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

      expect(result.id).toBeDefined()
      expect(result.status).toBe('queued')
      expect(result.importBatchId).toBe(testImportBatchId)
      expect(result.model).toBe('stub_summarizer_v1')
      expect(result.sources).toEqual(['chatgpt'])
      expect(result.startDate).toBe('2024-01-01')
      expect(result.endDate).toBe('2024-01-02')
      expect(result.jobCount).toBe(2)

      // Verify frozen config
      expect(result.config.labelSpec).toEqual({
        model: 'stub_v1',
        promptVersionId: testClassifyPromptVersionId,
      })
      expect(result.config.filterProfile.name).toBe(`Test Filter ${testUniqueId}`)
      expect(result.config.filterProfile.mode).toBe('exclude')
      expect(result.config.filterProfile.categories).toEqual(['WORK'])
      expect(result.config.timezone).toBe('America/New_York')
      expect(result.config.maxInputTokens).toBe(12000) // Default

      // Verify jobs were created
      const jobs = await prisma.job.findMany({
        where: { runId: result.id },
        orderBy: { dayDate: 'asc' },
      })

      expect(jobs).toHaveLength(2)
      expect(jobs[0].status).toBe('QUEUED')
      expect(jobs[1].status).toBe('QUEUED')
    })

    it('respects maxInputTokens parameter', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        maxInputTokens: 50000,
      })

      expect(result.config.maxInputTokens).toBe(50000)
    })

    it('throws error if import batch not found', async () => {
      await expect(
        createRun({
          importBatchId: 'nonexistent-id',
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
      ).rejects.toThrow('ImportBatch not found')
    })

    it('throws error if filter profile not found', async () => {
      await expect(
        createRun({
          importBatchId: testImportBatchId,
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt'],
          filterProfileId: 'nonexistent-id',
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
      ).rejects.toThrow('FilterProfile not found')
    })

    it('throws error if labelSpec promptVersionId not found', async () => {
      await expect(
        createRun({
          importBatchId: testImportBatchId,
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'stub_summarizer_v1',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: 'nonexistent-id',
          },
        })
      ).rejects.toThrow('LabelSpec promptVersionId not found')
    })

    it('selects default labelSpec when omitted (SPEC §7.3)', async () => {
      // The test's CLASSIFY PromptVersion has createdAt=2099, ensuring it
      // always wins createRun's default selection (findFirst orderBy
      // createdAt desc) even when parallel tests create their own active
      // CLASSIFY versions. Labels already point at testClassifyPromptVersionId.

      // Call createRun without labelSpec — server should pick default
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        // labelSpec intentionally omitted
      })

      expect(result.id).toBeDefined()
      expect(result.status).toBe('queued')
      expect(result.jobCount).toBe(2)

      // Verify server-selected default labelSpec uses this test's version
      expect(result.config.labelSpec).toEqual({
        model: 'stub_v1',
        promptVersionId: testClassifyPromptVersionId,
      })
    })

    it('ignores assistant-only days for eligibility (SPEC §7.3 step 6)', async () => {
      // Delete all atoms and labels for day 2, then create only assistant atoms
      const day2Atoms = await prisma.messageAtom.findMany({
        where: {
          importBatchId: testImportBatchId,
          dayDate: new Date('2024-01-02'),
        },
      })
      await prisma.messageLabel.deleteMany({
        where: { messageAtomId: { in: day2Atoms.map((a) => a.id) } },
      })
      await prisma.messageAtom.deleteMany({
        where: { id: { in: day2Atoms.map((a) => a.id) } },
      })

      // Create assistant-only atoms for day 2
      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: 'ASSISTANT',
            text: `Assistant-only message day2-${j}`,
            textHash: `text-hash-${testUniqueId}-assist-only-${j}`,
            timestampUtc: new Date(new Date('2024-01-02T12:00:00Z').getTime() + j * 1000),
            dayDate: new Date('2024-01-02'),
            atomStableId: `test-run-atom-${testUniqueId}-assist-only-${j}`,
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

      const result = await createRun({
        importBatchId: testImportBatchId,
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

      // Day 1 has user atoms → eligible. Day 2 has only assistant atoms → not eligible.
      expect(result.jobCount).toBe(1)
      expect(result.eligibleDays).toEqual(['2024-01-01'])
    })

    it('throws NO_ELIGIBLE_DAYS when filter excludes all days', async () => {
      // Update only labels for this test's atoms to WORK (which is excluded by our filter)
      await prisma.messageLabel.updateMany({
        where: { messageAtom: { importBatchId: testImportBatchId } },
        data: { category: 'WORK' },
      })

      await expect(
        createRun({
          importBatchId: testImportBatchId,
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
      ).rejects.toThrow('NO_ELIGIBLE_DAYS')
    })
  })
})
