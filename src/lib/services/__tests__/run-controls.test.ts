/**
 * Tests for Run Controls (cancel/resume/reset)
 *
 * Spec references: 7.6 (Resume / Cancel), 7.7 (Reset / Reprocess)
 *
 * Acceptance tests for:
 * - Cancel stops processing
 * - Resume requeues failed jobs
 * - Reset allows reprocessing specific days
 * - Terminal status rule: cancelled is authoritative
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { createRun, cancelRun, resumeRun, resetJob } from '../run'
import { processTick } from '../tick'

describe('run controls', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    // Generate unique suffix for this test run
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create test import batch
    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-run-controls.json',
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
    testImportBatchId = importBatch.id

    // Create test filter profile
    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test Run Controls Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    // Create test prompts and versions
    const classifyPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `Test Run Controls Classify ${testUniqueId}`,
      },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-controls-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `Test Run Controls Summarize ${testUniqueId}`,
      },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-controls-v1',
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
      await prisma.rawEntry.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          dayDate: new Date(dayDate.toISOString().split('T')[0]),
          contentText: `Test content for day ${i}`,
          contentHash: `test-controls-hash-${testUniqueId}-${i}`,
        },
      })

      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Test message ${i}-${j} for run controls`,
            textHash: `text-controls-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(dayDate.getTime() + j * 1000),
            dayDate: new Date(dayDate.toISOString().split('T')[0]),
            atomStableId: `test-controls-atom-${testUniqueId}-${i}-${j}`,
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
  })

  afterEach(async () => {
    // Clean up in correct order
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

  // Helper to create a test run
  async function createTestRun() {
    return createRun({
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
  }

  describe('cancelRun', () => {
    it('cancels a queued run and its jobs', async () => {
      const run = await createTestRun()
      expect(run.jobCount).toBe(2)

      const result = await cancelRun(run.id)

      expect(result.status).toBe('cancelled')
      expect(result.jobsCancelled).toBe(2)

      // Verify in DB
      const updatedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(updatedRun?.status).toBe('CANCELLED')

      const jobs = await prisma.job.findMany({ where: { runId: run.id } })
      expect(jobs.every((j) => j.status === 'CANCELLED')).toBe(true)
    })

    it('stops tick processing after cancel (spec 7.6)', async () => {
      const run = await createTestRun()

      // Cancel the run
      await cancelRun(run.id)

      // Try to process a tick
      const tickResult = await processTick({ runId: run.id })

      // Should not process any jobs
      expect(tickResult.processed).toBe(0)
      expect(tickResult.runStatus).toBe('cancelled')
    })

    it('is idempotent on already-cancelled run', async () => {
      const run = await createTestRun()

      // Cancel twice
      const result1 = await cancelRun(run.id)
      const result2 = await cancelRun(run.id)

      expect(result1.status).toBe('cancelled')
      expect(result2.status).toBe('cancelled')
      expect(result2.jobsCancelled).toBe(0) // Already cancelled
    })

    it('throws error on completed run', async () => {
      const run = await createTestRun()

      // Complete all jobs
      await processTick({ runId: run.id, maxJobs: 10 })

      // Verify run is completed
      const completedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(completedRun?.status).toBe('COMPLETED')

      // Try to cancel
      await expect(cancelRun(run.id)).rejects.toThrow('ALREADY_COMPLETED')
    })

    it('throws error on non-existent run', async () => {
      await expect(cancelRun('nonexistent-id')).rejects.toThrow('Run not found')
    })
  })

  describe('resumeRun', () => {
    it('requeues failed jobs and sets run to QUEUED', async () => {
      const run = await createTestRun()

      // Manually fail some jobs
      await prisma.job.updateMany({
        where: { runId: run.id },
        data: { status: 'FAILED' },
      })
      await prisma.run.update({
        where: { id: run.id },
        data: { status: 'FAILED' },
      })

      const result = await resumeRun(run.id)

      expect(result.status).toBe('queued')
      expect(result.jobsRequeued).toBe(2)

      // Verify in DB
      const updatedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(updatedRun?.status).toBe('QUEUED')

      const jobs = await prisma.job.findMany({ where: { runId: run.id } })
      expect(jobs.every((j) => j.status === 'QUEUED')).toBe(true)
    })

    it('only requeues failed jobs, not succeeded (spec 11.3)', async () => {
      const run = await createTestRun()

      // Process first job
      await processTick({ runId: run.id })

      // Fail the second job manually
      await prisma.job.updateMany({
        where: { runId: run.id, status: 'QUEUED' },
        data: { status: 'FAILED' },
      })
      await prisma.run.update({
        where: { id: run.id },
        data: { status: 'FAILED' },
      })

      const result = await resumeRun(run.id)

      expect(result.jobsRequeued).toBe(1) // Only the failed one

      // Verify succeeded job is unchanged
      const jobs = await prisma.job.findMany({
        where: { runId: run.id },
        orderBy: { dayDate: 'asc' },
      })
      expect(jobs[0].status).toBe('SUCCEEDED')
      expect(jobs[1].status).toBe('QUEUED')
    })

    it('throws error on cancelled run (terminal status rule)', async () => {
      const run = await createTestRun()

      // Cancel the run
      await cancelRun(run.id)

      // Try to resume
      await expect(resumeRun(run.id)).rejects.toThrow('CANNOT_RESUME_CANCELLED')
    })

    it('throws error on non-existent run', async () => {
      await expect(resumeRun('nonexistent-id')).rejects.toThrow('Run not found')
    })

    it('is safe when no jobs are FAILED (no-op)', async () => {
      const run = await createTestRun()

      // Run is QUEUED with QUEUED jobs - nothing to resume
      const result = await resumeRun(run.id)

      expect(result.jobsRequeued).toBe(0)
      // Run status should remain QUEUED (not change)
      const updatedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(updatedRun?.status).toBe('QUEUED')
    })

    it('is safe on completed run with no failed jobs', async () => {
      const run = await createTestRun()

      // Process all jobs
      await processTick({ runId: run.id, maxJobs: 10 })

      // Verify run is completed
      const completedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(completedRun?.status).toBe('COMPLETED')

      // Resume should be a no-op (no failed jobs)
      const result = await resumeRun(run.id)
      expect(result.jobsRequeued).toBe(0)

      // Run should remain COMPLETED
      const stillCompletedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(stillCompletedRun?.status).toBe('COMPLETED')
    })
  })

  describe('resetJob', () => {
    it('resets a succeeded job for reprocessing (spec 7.7)', async () => {
      const run = await createTestRun()

      // Process all jobs
      await processTick({ runId: run.id, maxJobs: 10 })

      // Verify jobs are SUCCEEDED
      const jobsBefore = await prisma.job.findMany({
        where: { runId: run.id },
        orderBy: { dayDate: 'asc' },
      })
      expect(jobsBefore.every((j) => j.status === 'SUCCEEDED')).toBe(true)

      // Check if outputs exist (may be empty due to bundle matching)
      const outputsBefore = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      const outputCountBefore = outputsBefore.length

      // Reset first day
      const result = await resetJob(run.id, '2024-01-01')

      expect(result.status).toBe('queued')
      expect(result.attempt).toBe(2) // Incremented

      // Verify in DB
      const job = await prisma.job.findFirst({
        where: { runId: run.id, dayDate: new Date('2024-01-01') },
      })
      expect(job?.status).toBe('QUEUED')
      expect(job?.attempt).toBe(2)

      // If there were outputs, verify one was deleted
      if (outputCountBefore > 0) {
        const outputsAfter = await prisma.output.findMany({
          where: { job: { runId: run.id } },
        })
        expect(outputsAfter.length).toBeLessThan(outputCountBefore)
      }

      // Verify run is back to QUEUED
      const updatedRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(updatedRun?.status).toBe('QUEUED')
    })

    it('increments attempt counter on each reset', async () => {
      const run = await createTestRun()

      // Process, reset, process, reset
      await processTick({ runId: run.id })
      await resetJob(run.id, '2024-01-01')

      // Process again
      await processTick({ runId: run.id })
      const result = await resetJob(run.id, '2024-01-01')

      expect(result.attempt).toBe(3) // Started at 1, reset twice
    })

    it('throws error on cancelled run', async () => {
      const run = await createTestRun()
      await cancelRun(run.id)

      await expect(resetJob(run.id, '2024-01-01')).rejects.toThrow('CANNOT_RESET_CANCELLED')
    })

    it('throws error on non-existent job', async () => {
      const run = await createTestRun()

      await expect(resetJob(run.id, '2099-12-31')).rejects.toThrow('Job not found')
    })

    it('throws error on non-existent run', async () => {
      await expect(resetJob('nonexistent-id', '2024-01-01')).rejects.toThrow('Run not found')
    })

    it('is safe on already-QUEUED job (increments attempt)', async () => {
      const run = await createTestRun()

      // Job is already QUEUED (no processing yet)
      const result = await resetJob(run.id, '2024-01-01')

      // Should succeed but increment attempt
      expect(result.status).toBe('queued')
      expect(result.attempt).toBe(2) // Was 1, now 2
      expect(result.outputsDeleted).toBe(0) // No outputs to delete

      // Second reset also safe
      const result2 = await resetJob(run.id, '2024-01-01')
      expect(result2.attempt).toBe(3)
    })
  })

  describe('terminal status rule', () => {
    it('tick does not transition cancelled run to any other status', async () => {
      const run = await createTestRun()

      // Cancel the run
      await cancelRun(run.id)

      // Try multiple ticks
      for (let i = 0; i < 3; i++) {
        const result = await processTick({ runId: run.id })
        expect(result.runStatus).toBe('cancelled')
      }

      // Verify run is still cancelled
      const finalRun = await prisma.run.findUnique({ where: { id: run.id } })
      expect(finalRun?.status).toBe('CANCELLED')
    })
  })
})
