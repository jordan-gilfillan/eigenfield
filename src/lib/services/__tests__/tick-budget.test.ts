/**
 * Tests for budget enforcement during tick/summarize processing.
 *
 * Verifies:
 * 1) Within cap succeeds normally
 * 2) Already-exceeded pre-call check blocks without making LLM call
 * 3) Cap exceeded after call in non-segmented flow → BUDGET_EXCEEDED, retriable=false
 * 4) Cap exceeded mid-segmentation → partial tokens/cost captured
 * 5) Budget spans across jobs in one tick (job 2 sees job 1's actual spend)
 * 6) Existing job spend loaded from DB and counted
 * 7) Stub model naturally bypasses (costUsd=0)
 *
 * AUD-058 — Enforce spend caps during summarize/tick execution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '../../db'
import { createRun } from '../run'

// Mock the summarizer module (same pattern as tick-real-summarize.test.ts)
vi.mock('../summarizer', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, Function>

  return {
    ...actual,
    summarize: vi.fn().mockImplementation(
      async (options: { bundleText: string; model: string; promptVersionId: string }) => {
        if (options.model.startsWith('stub')) {
          return actual.summarize(options)
        }
        return (globalThis as Record<string, unknown>).__testBudgetSummarizeMock?.(options)
          ?? Promise.reject(new Error('Test mock not configured for real model'))
      }
    ),
  }
})

import { processTick } from '../tick'

/** Configure the behavior of summarize() for non-stub models. */
function mockRealSummarize(fn: (...args: unknown[]) => unknown) {
  (globalThis as Record<string, unknown>).__testBudgetSummarizeMock = fn
}

const realSummarizeCalls: unknown[][] = []

function mockRealSummarizeResolved(result: { text: string; tokensIn: number; tokensOut: number; costUsd: number }) {
  realSummarizeCalls.length = 0
  mockRealSummarize((...args: unknown[]) => {
    realSummarizeCalls.push(args)
    return Promise.resolve(result)
  })
}

function mockRealSummarizeImpl(fn: (options: { bundleText: string; model: string; promptVersionId: string }) => Promise<{ text: string; tokensIn: number; tokensOut: number; costUsd: number }>) {
  realSummarizeCalls.length = 0
  mockRealSummarize((...args: unknown[]) => {
    realSummarizeCalls.push(args)
    return fn(args[0] as { bundleText: string; model: string; promptVersionId: string })
  })
}

// Save and restore env vars for spend cap configuration
const savedEnv: Record<string, string | undefined> = {}

function setSpendCap(key: string, value: string | undefined) {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key]
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  Object.keys(savedEnv).forEach((k) => delete savedEnv[k])
}

describe('tick budget enforcement', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    realSummarizeCalls.length = 0
    delete (globalThis as Record<string, unknown>).__testBudgetSummarizeMock

    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-budget.json',
        fileSizeBytes: 2000,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 10,
          day_count: 2,
          coverage_start: '2024-06-15',
          coverage_end: '2024-06-16',
        },
      },
    })
    testImportBatchId = importBatch.id

    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Test Budget Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    const classifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Test Budget Classify ${testUniqueId}` },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-budget-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Test Budget Summarize ${testUniqueId}` },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-budget-v1',
        templateText: 'You are summarizing a day of AI conversation messages.',
        isActive: true,
      },
    })
    testSummarizePromptVersionId = summarizeVersion.id

    // Create atoms with labels for 2 days (3 atoms per day)
    for (let i = 0; i < 2; i++) {
      const dayStr = i === 0 ? '2024-06-15' : '2024-06-16'
      const dayDate = new Date(dayStr + 'T00:00:00Z')
      const tsBase = new Date(dayStr + 'T12:00:00Z')

      await prisma.rawEntry.create({
        data: {
          importBatchId: testImportBatchId,
          source: 'CHATGPT',
          dayDate,
          contentText: `Test content for day ${i}`,
          contentHash: `test-budget-hash-${testUniqueId}-${i}`,
        },
      })

      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Budget test message ${i}-${j}`,
            textHash: `text-budget-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(tsBase.getTime() + j * 1000),
            dayDate,
            atomStableId: `test-budget-atom-${testUniqueId}-${i}-${j}`,
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
    restoreEnv()

    await prisma.output.deleteMany({
      where: { job: { run: { importBatchId: testImportBatchId } } },
    })
    await prisma.job.deleteMany({
      where: { run: { importBatchId: testImportBatchId } },
    })
    await prisma.runBatch.deleteMany({
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
    await prisma.promptVersion.deleteMany({
      where: { id: { in: [testClassifyPromptVersionId, testSummarizePromptVersionId].filter(Boolean) } },
    })
    await prisma.prompt.deleteMany({
      where: { id: { in: [testClassifyPromptId, testSummarizePromptId].filter(Boolean) } },
    })
  })

  async function createTestRun(model: string, opts?: { maxInputTokens?: number; days?: string }) {
    const endDate = opts?.days === '1' ? '2024-06-15' : '2024-06-16'
    return createRun({
      importBatchId: testImportBatchId,
      startDate: '2024-06-15',
      endDate,
      sources: ['chatgpt'],
      filterProfileId: testFilterProfileId,
      model,
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: testClassifyPromptVersionId,
      },
      maxInputTokens: opts?.maxInputTokens,
    })
  }

  describe('within cap succeeds', () => {
    it('processes job successfully when cost is within per-run cap', async () => {
      setSpendCap('LLM_MAX_USD_PER_RUN', '10.00')

      mockRealSummarizeResolved({
        text: 'Summary within budget.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.002,
      })

      const run = await createTestRun('gpt-4o', { days: '1' })
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
      expect(realSummarizeCalls).toHaveLength(1)
    })

    it('stub model naturally bypasses budget (costUsd=0)', async () => {
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.001') // Very tight cap

      const run = await createTestRun('stub_summarizer_v1', { days: '1' })
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
      expect(result.jobs[0].costUsd).toBe(0)
    })
  })

  describe('pre-call check blocks when already exceeded', () => {
    it('blocks before making LLM call when existing spend already exceeds cap', async () => {
      // Create a run with 1 day, process it to accumulate spend
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.01')

      mockRealSummarizeResolved({
        text: 'First summary.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.02, // Exceeds the $0.01 cap
      })

      const run = await createTestRun('gpt-4o')

      // First tick: processes day 1, post-call check fails → BUDGET_EXCEEDED
      const result1 = await processTick({ runId: run.id })
      expect(result1.jobs[0].status).toBe('failed')

      // Manually requeue the second day's job to test pre-call block
      // (day 1 failed but day 2 is still queued from run creation)
      const result2 = await processTick({ runId: run.id })

      // Day 2: pre-call check sees existing spend from day 1 (partial cost captured)
      // and blocks before making the LLM call
      expect(result2.processed).toBe(1)
      expect(result2.jobs[0].status).toBe('failed')

      const failedJob = await prisma.job.findFirst({
        where: { runId: run.id, dayDate: new Date('2024-06-16T00:00:00Z') },
      })
      const errorObj = JSON.parse(failedJob!.error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
      expect(errorObj.retriable).toBe(false)
    })
  })

  describe('post-call check in non-segmented flow', () => {
    it('fails job with BUDGET_EXCEEDED when single call exceeds cap', async () => {
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.001') // Very tight cap

      mockRealSummarizeResolved({
        text: 'Expensive summary.',
        tokensIn: 5000,
        tokensOut: 1000,
        costUsd: 0.05, // Way over $0.001 cap
      })

      const run = await createTestRun('gpt-4o', { days: '1' })
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('failed')

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(jobs).toHaveLength(1)
      const errorObj = JSON.parse(jobs[0].error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
      expect(errorObj.retriable).toBe(false)

      // Summarize was called (pre-call check passed, post-call caught it)
      expect(realSummarizeCalls).toHaveLength(1)

      // No output stored (caught in catch block)
      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(0)
    })
  })

  describe('cap exceeded mid-segmentation', () => {
    it('captures partial tokens/cost from completed segments', async () => {
      // Cap $0.003: segment 1 costs $0.004 → post-call check after seg 1 catches it
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.003')

      let callCount = 0
      mockRealSummarizeImpl(async () => {
        callCount++
        return {
          text: `Segment ${callCount} summary.`,
          tokensIn: 300,
          tokensOut: 60,
          costUsd: 0.004,
        }
      })

      const run = await createTestRun('gpt-4o', { days: '1', maxInputTokens: 10 })
      const result = await processTick({ runId: run.id })

      expect(result.jobs[0].status).toBe('failed')

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(jobs).toHaveLength(1)

      const errorObj = JSON.parse(jobs[0].error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
      expect(errorObj.retriable).toBe(false)

      // Partial tokens from segment 1 captured
      expect(jobs[0].tokensIn).toBe(300)
      expect(jobs[0].tokensOut).toBe(60)
      expect(jobs[0].costUsd).toBeGreaterThan(0)

      // Only 1 segment processed before budget check caught it
      expect(callCount).toBe(1)
    })
  })

  describe('budget spans across jobs in one tick', () => {
    it('job 2 sees job 1 actual spend (maxJobs=2)', async () => {
      // gpt-4o pricing: input $2.5/M, output $10/M
      // tokensIn=2000, tokensOut=100 → pricing snapshot cost = $0.006
      // Cap $0.01: job 1 costs $0.006 (ok), job 2 post-call: 0.006+0.006=0.012 > 0.01 → fails
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.01')

      let callCount = 0
      mockRealSummarizeImpl(async () => {
        callCount++
        return {
          text: `Day ${callCount} summary.`,
          tokensIn: 2000,
          tokensOut: 100,
          costUsd: 0.006, // Aligned with gpt-4o pricing snapshot
        }
      })

      const run = await createTestRun('gpt-4o') // 2 days = 2 jobs
      const result = await processTick({ runId: run.id, maxJobs: 2 })

      expect(result.processed).toBe(2)

      // Job 1 succeeds (within cap)
      expect(result.jobs[0].status).toBe('succeeded')

      // Job 2 fails (post-call check catches accumulated spend)
      expect(result.jobs[1].status).toBe('failed')

      const failedJobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(failedJobs).toHaveLength(1)
      const errorObj = JSON.parse(failedJobs[0].error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
    })
  })

  describe('existing job spend from DB counted', () => {
    it('previous tick spend counted toward budget in next tick', async () => {
      // gpt-4o pricing: tokensIn=2000, tokensOut=100 → $0.006 per job
      // Cap $0.01: tick 1 costs $0.006, tick 2 post-call: 0.006+0.006=0.012 > 0.01
      setSpendCap('LLM_MAX_USD_PER_RUN', '0.01')

      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 2000,
        tokensOut: 100,
        costUsd: 0.006, // Aligned with gpt-4o pricing snapshot
      })

      const run = await createTestRun('gpt-4o') // 2 days

      // Tick 1: processes day 1, cost $0.006 (within $0.01 cap)
      const result1 = await processTick({ runId: run.id })
      expect(result1.processed).toBe(1)
      expect(result1.jobs[0].status).toBe('succeeded')

      // Tick 2: processes day 2, existing DB spend ($0.006) + new cost ($0.006) > cap ($0.01)
      const result2 = await processTick({ runId: run.id })
      expect(result2.processed).toBe(1)
      expect(result2.jobs[0].status).toBe('failed')

      const failedJobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(failedJobs).toHaveLength(1)
      const errorObj = JSON.parse(failedJobs[0].error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
    })
  })

  describe('no cap set', () => {
    it('processes normally when no spend cap env vars are set', async () => {
      // Ensure no caps are set
      setSpendCap('LLM_MAX_USD_PER_RUN', undefined)
      setSpendCap('LLM_MAX_USD_PER_DAY', undefined)

      mockRealSummarizeResolved({
        text: 'Summary without caps.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 100.0, // Very high cost, but no cap
      })

      const run = await createTestRun('gpt-4o', { days: '1' })
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
    })
  })
})
