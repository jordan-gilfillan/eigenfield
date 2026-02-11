/**
 * Integration tests for getCalendarDaySpendUsd().
 *
 * Verifies:
 * 1) No data → returns 0
 * 2) Job spend today → summed
 * 3) ClassifyRun spend today → summed
 * 4) Combined Job + ClassifyRun spend
 * 5) Yesterday's data excluded
 * 6) nowUtc parameter controls day boundary
 *
 * AUD-060 — Correct per-day budget to calendar-day spend
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { getCalendarDaySpendUsd } from '../budget-queries'

describe('getCalendarDaySpendUsd', () => {
  let testImportBatchId: string
  let testRunId: string
  let testFilterProfileId: string
  let testPromptVersionId: string
  let testPromptId: string
  let testUniqueId: string
  const createdJobIds: string[] = []
  const createdClassifyRunIds: string[] = []

  beforeEach(async () => {
    createdJobIds.length = 0
    createdClassifyRunIds.length = 0
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-day-spend.json',
        fileSizeBytes: 1000,
        timezone: 'UTC',
        statsJson: {
          message_count: 1,
          day_count: 1,
          coverage_start: '2024-06-15',
          coverage_end: '2024-06-15',
        },
      },
    })
    testImportBatchId = importBatch.id

    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test DaySpend Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    const prompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Test DaySpend ${testUniqueId}` },
    })
    testPromptId = prompt.id

    const promptVersion = await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionLabel: 'test-ds-v1',
        templateText: 'Test prompt',
        isActive: true,
      },
    })
    testPromptVersionId = promptVersion.id

    // Create a minimal run to host jobs
    const run = await prisma.run.create({
      data: {
        importBatch: { connect: { id: testImportBatchId } },
        filterProfile: { connect: { id: testFilterProfileId } },
        model: 'stub_summarizer_v1',
        startDate: new Date('2024-06-15'),
        endDate: new Date('2024-06-15'),
        sources: ['chatgpt'],
        status: 'COMPLETED',
        configJson: {},
      },
    })
    testRunId = run.id
  })

  afterEach(async () => {
    // Clean up in dependency order
    await prisma.job.deleteMany({
      where: { id: { in: createdJobIds } },
    })
    await prisma.classifyRun.deleteMany({
      where: { id: { in: createdClassifyRunIds } },
    })
    await prisma.run.deleteMany({
      where: { id: testRunId },
    })
    await prisma.filterProfile.deleteMany({
      where: { id: testFilterProfileId },
    })
    await prisma.importBatch.deleteMany({
      where: { id: testImportBatchId },
    })
    await prisma.promptVersion.deleteMany({
      where: { id: testPromptVersionId },
    })
    await prisma.prompt.deleteMany({
      where: { id: testPromptId },
    })
  })

  it('returns 0 when no data exists for the day', async () => {
    // Query for a day far in the past with no data
    const result = await getCalendarDaySpendUsd(new Date('2020-01-01T12:00:00Z'))
    expect(result).toBe(0)
  })

  // Use a fixed reference date far in the past to avoid interference from other tests
  // that create jobs/classify runs with finishedAt = now()
  const REF_DATE = new Date('2023-01-15T14:00:00Z')

  it('sums Job spend for the reference day', async () => {
    const job1 = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-15'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-15T10:00:00Z'),
        costUsd: 0.005,
      },
    })
    createdJobIds.push(job1.id)

    const job2 = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-16'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-15T18:00:00Z'),
        costUsd: 0.003,
      },
    })
    createdJobIds.push(job2.id)

    const result = await getCalendarDaySpendUsd(REF_DATE)
    expect(result).toBeCloseTo(0.008, 6)
  })

  it('sums ClassifyRun spend for the reference day', async () => {
    const cr = await prisma.classifyRun.create({
      data: {
        importBatchId: testImportBatchId,
        model: 'gpt-4o',
        promptVersionId: testPromptVersionId,
        mode: 'real',
        status: 'succeeded',
        totalAtoms: 10,
        newlyLabeled: 10,
        skippedAlreadyLabeled: 0,
        labeledTotal: 10,
        finishedAt: new Date('2023-01-15T12:00:00Z'),
        costUsd: 0.012,
      },
    })
    createdClassifyRunIds.push(cr.id)

    const result = await getCalendarDaySpendUsd(REF_DATE)
    expect(result).toBeCloseTo(0.012, 6)
  })

  it('combines Job and ClassifyRun spend', async () => {
    const job = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-15'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-15T09:00:00Z'),
        costUsd: 0.005,
      },
    })
    createdJobIds.push(job.id)

    const cr = await prisma.classifyRun.create({
      data: {
        importBatchId: testImportBatchId,
        model: 'gpt-4o',
        promptVersionId: testPromptVersionId,
        mode: 'real',
        status: 'succeeded',
        totalAtoms: 10,
        newlyLabeled: 10,
        skippedAlreadyLabeled: 0,
        labeledTotal: 10,
        finishedAt: new Date('2023-01-15T15:00:00Z'),
        costUsd: 0.007,
      },
    })
    createdClassifyRunIds.push(cr.id)

    const result = await getCalendarDaySpendUsd(REF_DATE)
    expect(result).toBeCloseTo(0.012, 6)
  })

  it('excludes previous day data', async () => {
    // Create job finished the day before the reference date
    const job = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-15'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-14T23:59:59Z'),
        costUsd: 0.050,
      },
    })
    createdJobIds.push(job.id)

    // Query for reference day — should not include previous day's job
    const result = await getCalendarDaySpendUsd(REF_DATE)
    expect(result).toBe(0)
  })

  it('nowUtc parameter controls day boundary', async () => {
    // Create a job finished at a specific known time
    const targetTime = new Date('2025-03-15T14:30:00Z')

    const job = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-15'),
        status: 'SUCCEEDED',
        finishedAt: targetTime,
        costUsd: 0.010,
      },
    })
    createdJobIds.push(job.id)

    // Querying with same day → found
    const sameDay = await getCalendarDaySpendUsd(new Date('2025-03-15T23:59:59Z'))
    expect(sameDay).toBeCloseTo(0.010, 6)

    // Querying with next day → not found
    const nextDay = await getCalendarDaySpendUsd(new Date('2025-03-16T00:00:00Z'))
    expect(nextDay).toBe(0)

    // Querying with previous day → not found
    const prevDay = await getCalendarDaySpendUsd(new Date('2025-03-14T12:00:00Z'))
    expect(prevDay).toBe(0)
  })

  it('ignores null costUsd values', async () => {
    // Job with null cost (stub)
    const job1 = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-15'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-15T11:00:00Z'),
        costUsd: null,
      },
    })
    createdJobIds.push(job1.id)

    // Job with real cost
    const job2 = await prisma.job.create({
      data: {
        runId: testRunId,
        dayDate: new Date('2024-06-16'),
        status: 'SUCCEEDED',
        finishedAt: new Date('2023-01-15T16:00:00Z'),
        costUsd: 0.004,
      },
    })
    createdJobIds.push(job2.id)

    const result = await getCalendarDaySpendUsd(REF_DATE)
    expect(result).toBeCloseTo(0.004, 6)
  })
})
