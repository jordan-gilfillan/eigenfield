/**
 * Tests for rate limiting during tick/summarize processing.
 *
 * Verifies:
 * 1) acquire() called before each summarize for non-stub models
 * 2) acquire() called per segment in segmented path
 * 3) LLM_MIN_DELAY_MS=0 → no-delay behavior (still acquires, just no wait)
 * 4) Stub model skips acquire()
 * 5) Rate limiter shared across jobs in one tick (same instance)
 *
 * AUD-059 — Apply LLM_MIN_DELAY_MS rate limiting to summarize/tick path
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '../../db'
import { createRun } from '../run'

type SummarizeOptions = { bundleText: string; model: string; promptVersionId: string }
type SummarizeResult = { text: string; tokensIn: number; tokensOut: number; costUsd: number }
type RateLimitSummarizeMock = (options: SummarizeOptions) => Promise<SummarizeResult>
type RateLimitTestGlobals = typeof globalThis & { __testRateLimitSummarizeMock?: RateLimitSummarizeMock }

const rateLimitTestGlobals = globalThis as RateLimitTestGlobals

// Module-level tracking for spy RateLimiter
const rateLimiterInstances: Array<{ acquireCount: number }> = []

// Ordered call log: tracks interleaving of acquire and summarize
const callLog: string[] = []

// Mock the summarizer module
vi.mock('../summarizer', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../summarizer')

  return {
    ...actual,
    summarize: vi.fn().mockImplementation(
      async (options: SummarizeOptions) => {
        if (options.model.startsWith('stub')) {
          return actual.summarize(options)
        }
        callLog.push('summarize')
        const summarizeMock = rateLimitTestGlobals.__testRateLimitSummarizeMock
        if (summarizeMock) {
          return summarizeMock(options)
        }
        return Promise.reject(new Error('Test mock not configured for real model'))
      }
    ),
  }
})

// Mock RateLimiter to track acquire() calls and instance creation
vi.mock('../../llm', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  const ActualRateLimiter = actual.RateLimiter as new (opts: { minDelayMs: number }) => { acquire(): Promise<void>; reset(): void }

  class SpyRateLimiter extends ActualRateLimiter {
    acquireCount = 0

    constructor(opts: { minDelayMs: number }) {
      super(opts)
      rateLimiterInstances.push(this)
    }

    async acquire(): Promise<void> {
      this.acquireCount++
      callLog.push('acquire')
      return super.acquire()
    }
  }

  return {
    ...actual,
    RateLimiter: SpyRateLimiter,
  }
})

import { processTick } from '../tick'

/** Configure the behavior of summarize() for non-stub models. */
function mockRealSummarize(fn: RateLimitSummarizeMock) {
  rateLimitTestGlobals.__testRateLimitSummarizeMock = fn
}

function mockRealSummarizeResolved(result: { text: string; tokensIn: number; tokensOut: number; costUsd: number }) {
  mockRealSummarize(() => Promise.resolve(result))
}

// Save and restore env vars
const savedEnv: Record<string, string | undefined> = {}

function setEnv(key: string, value: string | undefined) {
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

describe('tick rate limiting', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    callLog.length = 0
    rateLimiterInstances.length = 0
    delete rateLimitTestGlobals.__testRateLimitSummarizeMock

    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-rate-limit.json',
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
        name: `Test RateLimit Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    const classifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Test RateLimit Classify ${testUniqueId}` },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-rl-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Test RateLimit Summarize ${testUniqueId}` },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-rl-v1',
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
          contentHash: `test-rl-hash-${testUniqueId}-${i}`,
        },
      })

      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Rate limit test message ${i}-${j}`,
            textHash: `text-rl-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(tsBase.getTime() + j * 1000),
            dayDate,
            atomStableId: `test-rl-atom-${testUniqueId}-${i}-${j}`,
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

    // Default: LLM_MIN_DELAY_MS=0 so tests run fast
    setEnv('LLM_MIN_DELAY_MS', '0')
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

  describe('non-stub model rate limiting', () => {
    it('acquire() called before summarize for single-bundle job', async () => {
      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.002,
      })

      const run = await createTestRun('gpt-4o', { days: '1' })
      await processTick({ runId: run.id })

      // acquire must appear before summarize in the call log
      expect(callLog).toEqual(['acquire', 'summarize'])
    })

    it('acquire() called per segment in segmented path', async () => {
      mockRealSummarizeResolved({
        text: 'Segment summary.',
        tokensIn: 200,
        tokensOut: 50,
        costUsd: 0.001,
      })

      // maxInputTokens=10 forces segmentation (each atom is ~20+ chars)
      const run = await createTestRun('gpt-4o', { days: '1', maxInputTokens: 10 })
      await processTick({ runId: run.id })

      // Each segment gets its own acquire→summarize pair
      const acquireCount = callLog.filter((c) => c === 'acquire').length
      const summarizeCount = callLog.filter((c) => c === 'summarize').length

      expect(acquireCount).toBeGreaterThanOrEqual(2)
      expect(acquireCount).toBe(summarizeCount)

      // Every acquire is followed by a summarize (interleaved pairs)
      for (let i = 0; i < callLog.length; i += 2) {
        expect(callLog[i]).toBe('acquire')
        expect(callLog[i + 1]).toBe('summarize')
      }
    })
  })

  describe('stub model skips rate limiting', () => {
    it('no acquire() calls for stub model', async () => {
      const run = await createTestRun('stub_summarizer_v1', { days: '1' })
      await processTick({ runId: run.id })

      // Stub model should not trigger acquire
      expect(callLog.filter((c) => c === 'acquire')).toHaveLength(0)
    })
  })

  describe('rate limiter shared across jobs', () => {
    it('same RateLimiter instance used for both jobs in one tick', async () => {
      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.002,
      })

      const run = await createTestRun('gpt-4o') // 2 days = 2 jobs
      await processTick({ runId: run.id, maxJobs: 2 })

      // Only one RateLimiter instance created for the tick
      expect(rateLimiterInstances).toHaveLength(1)

      // Both jobs' acquire calls went through the same instance
      expect(rateLimiterInstances[0].acquireCount).toBe(2)

      // 2 acquire→summarize pairs
      expect(callLog).toEqual(['acquire', 'summarize', 'acquire', 'summarize'])
    })
  })

  describe('LLM_MIN_DELAY_MS=0 behavior', () => {
    it('acquire still called but completes immediately', async () => {
      setEnv('LLM_MIN_DELAY_MS', '0')

      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.002,
      })

      const run = await createTestRun('gpt-4o', { days: '1' })
      await processTick({ runId: run.id })

      // acquire was called even with 0ms delay
      expect(callLog).toEqual(['acquire', 'summarize'])
      expect(rateLimiterInstances[0].acquireCount).toBe(1)
    })
  })
})
