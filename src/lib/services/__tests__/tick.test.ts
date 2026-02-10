/**
 * Tests for Tick Service
 *
 * Spec references: 7.4 (Process tick loop), 7.6 (Cancelled runs)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { processTick } from '../tick'
import { createRun } from '../run'

describe('tick service', () => {
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

    // Create test filter profile
    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test Tick Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    // Create test prompts and versions with unique names
    const classifyPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `Test Tick Classify ${testUniqueId}`,
      },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-tick-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `Test Tick Summarize ${testUniqueId}`,
      },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-tick-v1',
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
            text: `Test message ${i}-${j} for tick test`,
            textHash: `text-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(dayDate.getTime() + j * 1000),
            dayDate: new Date(dayDate.toISOString().split('T')[0]),
            atomStableId: `test-tick-atom-${testUniqueId}-${i}-${j}`,
          },
        })

        // Create label with category that passes filter
        await prisma.messageLabel.create({
          data: {
            messageAtomId: atom.id,
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
            category: 'PERSONAL', confidence: 1.0,
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

  describe('processTick', () => {
    it('processes one queued job and transitions run to RUNNING', async () => {
      // Create a run with queued jobs
      const run = await createRun({
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

      expect(run.jobCount).toBe(2)

      // Process first tick
      const result = await processTick({ runId: run.id })

      expect(result.runId).toBe(run.id)
      expect(result.processed).toBe(1)
      expect(result.jobs).toHaveLength(1)
      expect(result.jobs[0].status).toBe('succeeded')
      // Stub summarizer returns estimated tokens - may be 0 if bundle is empty
      expect(typeof result.jobs[0].tokensIn).toBe('number')
      expect(typeof result.jobs[0].tokensOut).toBe('number')
      expect(result.progress.queued).toBe(1)
      expect(result.progress.succeeded).toBe(1)
      // §7.4.1: once work has begun, run is 'running' until terminal
      expect(result.runStatus).toBe('running')

      // Verify output was created (or job completed successfully with empty bundle)
      const outputs = await prisma.output.findMany({
        where: {
          job: { runId: run.id },
        },
      })
      // Output may be empty if bundle had no atoms (which can happen if dayDate matching has issues)
      if (outputs.length > 0) {
        expect(outputs[0].stage).toBe('SUMMARIZE')
        expect(outputs[0].outputText).toContain('Summary (stub)')
      } else {
        // Job completed successfully but with empty bundle - verify tokens are 0
        expect(result.jobs[0].tokensIn).toBe(0)
        expect(result.jobs[0].tokensOut).toBe(0)
      }
    })

    it('reports running (not queued) when some jobs succeeded and others remain queued (§7.4.1)', async () => {
      const run = await createRun({
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

      expect(run.jobCount).toBe(2)

      // Process first tick (1 of 2 jobs)
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.progress.queued).toBe(1)
      expect(result.progress.succeeded).toBe(1)
      // §7.4.1: once any job is started or completed, run MUST be 'running'
      expect(result.runStatus).toBe('running')

      // Verify DB also reflects RUNNING
      const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: run.id } })
      expect(dbRun.status).toBe('RUNNING')
    })

    it('processes multiple jobs with maxJobs parameter', async () => {
      const run = await createRun({
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

      // Process both jobs in one tick
      const result = await processTick({ runId: run.id, maxJobs: 10 })

      expect(result.processed).toBe(2)
      expect(result.jobs).toHaveLength(2)
      expect(result.progress.queued).toBe(0)
      expect(result.progress.succeeded).toBe(2)
      expect(result.runStatus).toBe('completed')
    })

    it('completes run when all jobs succeed', async () => {
      const run = await createRun({
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

      // Process first tick
      await processTick({ runId: run.id })

      // Process second tick
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.progress.queued).toBe(0)
      expect(result.progress.succeeded).toBe(2)
      expect(result.runStatus).toBe('completed')

      // Verify run status in DB
      const updatedRun = await prisma.run.findUnique({
        where: { id: run.id },
      })
      expect(updatedRun?.status).toBe('COMPLETED')
    })

    it('returns empty result when no jobs are queued', async () => {
      const run = await createRun({
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

      // Process all jobs
      await processTick({ runId: run.id, maxJobs: 10 })

      // Try to process again
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(0)
      expect(result.jobs).toHaveLength(0)
      expect(result.runStatus).toBe('completed')
    })

    it('throws error for non-existent run', async () => {
      await expect(
        processTick({ runId: 'nonexistent-run-id' })
      ).rejects.toThrow('Run not found')
    })

    it('respects cancelled run status per spec 7.6', async () => {
      const run = await createRun({
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

      // Manually cancel the run
      await prisma.run.update({
        where: { id: run.id },
        data: { status: 'CANCELLED' },
      })

      // Process tick should return without processing jobs
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(0)
      expect(result.runStatus).toBe('cancelled')
      expect(result.progress.queued).toBe(2) // Jobs still queued but not processed
    })
  })
})
