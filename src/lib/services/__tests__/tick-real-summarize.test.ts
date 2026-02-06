/**
 * Tests for tick service with real (non-stub) summarization.
 *
 * Mocks the summarizer module so that:
 * - Stub models delegate to the real stub implementation (unchanged behavior).
 * - Non-stub models return controlled SummarizeResult or throw LLM errors.
 *
 * Verifies:
 * 1) Non-stub model triggers real summarize path (not stub)
 * 2) Output.outputText is stored from summarize result
 * 3) Job tokens/cost populated and nonzero when pricing snapshot exists
 * 4) Segmented bundle: multiple calls; tokens/cost sum correctly; meta records segmentation
 * 5) Provider error → job FAILED, error recorded, no output row created
 * 6) Partial segment failure captures partial tokens/cost
 *
 * Spec references: 7.4 (tick), 9.2 (segmentation), 6.9 (Job), 6.10 (Output)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '../../db'
import { createRun } from '../run'
import { LlmProviderError, BudgetExceededError, MissingApiKeyError } from '../../llm/errors'

// Mock the summarizer module at the integration boundary.
// We replace summarize() with a vi.fn() that delegates to stubSummarize for stub models
// and to a configurable mock for real models.
vi.mock('../summarizer', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, Function>

  return {
    ...actual,
    summarize: vi.fn().mockImplementation(
      async (options: { bundleText: string; model: string; promptVersionId: string }) => {
        if (options.model.startsWith('stub')) {
          return actual.summarize(options)
        }
        // For real models, call the global test hook
        return (globalThis as Record<string, unknown>).__testRealSummarizeMock?.(options)
          ?? Promise.reject(new Error('Test mock not configured for real model'))
      }
    ),
  }
})

import { processTick } from '../tick'

/** Configure the behavior of summarize() for non-stub models. */
function mockRealSummarize(fn: (...args: unknown[]) => unknown) {
  (globalThis as Record<string, unknown>).__testRealSummarizeMock = fn
}

/** Track calls to the real summarize mock. */
const realSummarizeCalls: unknown[][] = []

function mockRealSummarizeResolved(result: { text: string; tokensIn: number; tokensOut: number; costUsd: number }) {
  realSummarizeCalls.length = 0
  mockRealSummarize((...args: unknown[]) => {
    realSummarizeCalls.push(args)
    return Promise.resolve(result)
  })
}

function mockRealSummarizeRejected(error: Error) {
  realSummarizeCalls.length = 0
  mockRealSummarize((...args: unknown[]) => {
    realSummarizeCalls.push(args)
    return Promise.reject(error)
  })
}

function mockRealSummarizeImpl(fn: (options: { bundleText: string; model: string; promptVersionId: string }) => Promise<{ text: string; tokensIn: number; tokensOut: number; costUsd: number }>) {
  realSummarizeCalls.length = 0
  mockRealSummarize((...args: unknown[]) => {
    realSummarizeCalls.push(args)
    return fn(args[0] as { bundleText: string; model: string; promptVersionId: string })
  })
}

describe('tick real summarization', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    // DON'T use vi.clearAllMocks() — it wipes the mock implementation set by vi.mock factory.
    // Instead, just reset our tracking state.
    realSummarizeCalls.length = 0
    delete (globalThis as Record<string, unknown>).__testRealSummarizeMock

    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-real-sum.json',
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
        name: `Test Real Sum Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })
    testFilterProfileId = filterProfile.id

    const classifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Test Real Sum Classify ${testUniqueId}` },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-real-v1',
        templateText: 'Test classify prompt',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Test Real Sum Summarize ${testUniqueId}` },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-real-v1',
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
          contentHash: `test-real-hash-${testUniqueId}-${i}`,
        },
      })

      for (let j = 0; j < 3; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: testImportBatchId,
            source: 'CHATGPT',
            role: j % 2 === 0 ? 'USER' : 'ASSISTANT',
            text: `Real sum test message ${i}-${j}`,
            textHash: `text-real-hash-${testUniqueId}-${i}-${j}`,
            timestampUtc: new Date(tsBase.getTime() + j * 1000),
            dayDate,
            atomStableId: `test-real-atom-${testUniqueId}-${i}-${j}`,
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
    await prisma.promptVersion.deleteMany({
      where: { id: { in: [testClassifyPromptVersionId, testSummarizePromptVersionId].filter(Boolean) } },
    })
    await prisma.prompt.deleteMany({
      where: { id: { in: [testClassifyPromptId, testSummarizePromptId].filter(Boolean) } },
    })
  })

  async function createTestRun(model: string) {
    return createRun({
      importBatchId: testImportBatchId,
      startDate: '2024-06-15',
      endDate: '2024-06-16',
      sources: ['chatgpt'],
      filterProfileId: testFilterProfileId,
      model,
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: testClassifyPromptVersionId,
      },
    })
  }

  describe('real model triggers summarize', () => {
    it('calls summarize for non-stub model and stores output', async () => {
      mockRealSummarizeResolved({
        text: '## Summary\n\nKey topics discussed today.',
        tokensIn: 500,
        tokensOut: 100,
        costUsd: 0.002,
      })

      const run = await createTestRun('gpt-4o')
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')

      // Verify summarize was called for the real model (not stub path)
      expect(realSummarizeCalls).toHaveLength(1)
      const callArgs = realSummarizeCalls[0][0] as { model: string; bundleText: string }
      expect(callArgs.model).toBe('gpt-4o')
      expect(callArgs.bundleText).toContain('SOURCE')
    })

    it('stores Output.outputText from summarize result', async () => {
      const expectedOutput = '## Daily Summary\n\nToday the team discussed project architecture.'
      mockRealSummarizeResolved({
        text: expectedOutput,
        tokensIn: 400,
        tokensOut: 80,
        costUsd: 0.0015,
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })

      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(1)
      expect(outputs[0].outputText).toBe(expectedOutput)
      expect(outputs[0].stage).toBe('SUMMARIZE')
      expect(outputs[0].model).toBe('gpt-4o')
    })

    it('populates job tokens and cost (nonzero) from summarize result', async () => {
      mockRealSummarizeResolved({
        text: 'Summary text.',
        tokensIn: 1200,
        tokensOut: 250,
        costUsd: 0.0055,
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })

      const jobs = await prisma.job.findMany({
        where: { runId: run.id },
        orderBy: { dayDate: 'asc' },
      })
      const processedJob = jobs.find((j) => j.status === 'SUCCEEDED')
      expect(processedJob).toBeDefined()
      expect(processedJob!.tokensIn).toBeGreaterThan(0)
      expect(processedJob!.tokensOut).toBeGreaterThan(0)
      // Cost recomputed from pricingSnapshot
      expect(processedJob!.costUsd).toBeGreaterThan(0)
    })

    it('uses pricingSnapshot to compute cost (overrides summarize costUsd)', async () => {
      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 1000,
        tokensOut: 200,
        costUsd: 0.99, // Arbitrary — should be overridden by pricingSnapshot
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'SUCCEEDED' },
      })
      expect(jobs).toHaveLength(1)
      // gpt-4o: input $2.5/M, output $10/M
      const expectedCost = (1000 / 1_000_000) * 2.5 + (200 / 1_000_000) * 10.0
      expect(jobs[0].costUsd).toBeCloseTo(expectedCost, 6)
      expect(jobs[0].costUsd).not.toBeCloseTo(0.99, 2)
    })

    it('processes all days with real model across multiple ticks', async () => {
      mockRealSummarizeResolved({
        text: 'Day summary.',
        tokensIn: 300,
        tokensOut: 60,
        costUsd: 0.001,
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })
      await processTick({ runId: run.id })

      expect(realSummarizeCalls).toHaveLength(2)

      const result = await processTick({ runId: run.id })
      expect(result.runStatus).toBe('completed')
      expect(result.progress.succeeded).toBe(2)
    })
  })

  describe('segmented bundles with real model', () => {
    it('calls summarize per segment and sums tokens/cost; meta records segmentation', async () => {
      let callCount = 0
      mockRealSummarizeImpl(async () => {
        callCount++
        return {
          text: `Segment ${callCount} summary content.`,
          tokensIn: 100 * callCount,
          tokensOut: 20 * callCount,
          costUsd: 0.001 * callCount,
        }
      })

      const run = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-06-15',
        endDate: '2024-06-15',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        maxInputTokens: 10, // Very small to force segmentation
      })

      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
      expect(callCount).toBeGreaterThan(1)

      // Output has segment headers
      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(1)
      expect(outputs[0].outputText).toContain('## Segment 1')
      expect(outputs[0].outputText).toContain('## Segment 2')

      // Meta records segmentation
      const meta = (outputs[0].outputJson as { meta: Record<string, unknown> }).meta
      expect(meta.segmented).toBe(true)
      expect(meta.segmentCount).toBeGreaterThan(1)
      expect(Array.isArray(meta.segmentIds)).toBe(true)

      // Job tokens summed across segments
      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'SUCCEEDED' },
      })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].tokensIn).toBeGreaterThan(100) // More than one segment
      expect(jobs[0].tokensOut).toBeGreaterThan(20)
      expect(jobs[0].costUsd).toBeGreaterThan(0)
    })
  })

  describe('provider error handling', () => {
    it('marks job FAILED on LlmProviderError; no output row created', async () => {
      mockRealSummarizeRejected(
        new LlmProviderError('openai', 'rate limit exceeded', { status: 429 })
      )

      const run = await createTestRun('gpt-4o')
      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('failed')
      expect(result.jobs[0].error).toContain('rate limit exceeded')

      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(0)

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(jobs).toHaveLength(1)
      const errorObj = JSON.parse(jobs[0].error as string)
      expect(errorObj.code).toBe('LLM_PROVIDER_ERROR')
      expect(errorObj.retriable).toBe(true)
    })

    it('marks job FAILED with retriable=false on BudgetExceededError', async () => {
      mockRealSummarizeRejected(
        new BudgetExceededError(0.01, 4.99, 5.0, 'per_run')
      )

      const run = await createTestRun('gpt-4o')
      const result = await processTick({ runId: run.id })

      expect(result.jobs[0].status).toBe('failed')

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      const errorObj = JSON.parse(jobs[0].error as string)
      expect(errorObj.code).toBe('BUDGET_EXCEEDED')
      expect(errorObj.retriable).toBe(false)
    })

    it('marks job FAILED with retriable=false on MissingApiKeyError', async () => {
      mockRealSummarizeRejected(
        new MissingApiKeyError('openai')
      )

      const run = await createTestRun('gpt-4o')
      const result = await processTick({ runId: run.id })

      expect(result.jobs[0].status).toBe('failed')

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      const errorObj = JSON.parse(jobs[0].error as string)
      expect(errorObj.code).toBe('MISSING_API_KEY')
      expect(errorObj.retriable).toBe(false)
    })

    it('captures partial tokens/cost when segment fails mid-way', async () => {
      let callCount = 0
      mockRealSummarizeImpl(async () => {
        callCount++
        if (callCount === 1) {
          return {
            text: 'Segment 1 done.',
            tokensIn: 200,
            tokensOut: 40,
            costUsd: 0.001,
          }
        }
        throw new LlmProviderError('openai', 'server error', { status: 500 })
      })

      const run = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-06-15',
        endDate: '2024-06-15',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
        maxInputTokens: 10,
      })

      const result = await processTick({ runId: run.id })

      expect(result.jobs[0].status).toBe('failed')

      const jobs = await prisma.job.findMany({
        where: { runId: run.id, status: 'FAILED' },
      })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].tokensIn).toBe(200)
      expect(jobs[0].tokensOut).toBe(40)
      expect(jobs[0].costUsd).toBeGreaterThan(0)

      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(0)
    })

    it('run status transitions to FAILED when all jobs fail', async () => {
      mockRealSummarizeRejected(
        new LlmProviderError('openai', 'service unavailable', { status: 503 })
      )

      const run = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-06-15',
        endDate: '2024-06-15',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      const result = await processTick({ runId: run.id })

      expect(result.runStatus).toBe('failed')
      expect(result.progress.failed).toBe(1)

      const updatedRun = await prisma.run.findUnique({
        where: { id: run.id },
      })
      expect(updatedRun?.status).toBe('FAILED')
    })
  })

  describe('stub model is unchanged', () => {
    it('uses stub summarize path (not the real mock) for stub model', async () => {
      const run = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-06-15',
        endDate: '2024-06-15',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      const result = await processTick({ runId: run.id })

      expect(result.processed).toBe(1)
      expect(result.jobs[0].status).toBe('succeeded')
      // Real mock should NOT have been called
      expect(realSummarizeCalls).toHaveLength(0)
    })
  })

  describe('output metadata', () => {
    it('stores bundleHash and bundleContextHash on output', async () => {
      mockRealSummarizeResolved({
        text: 'Summary with hashes.',
        tokensIn: 300,
        tokensOut: 50,
        costUsd: 0.001,
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })

      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(1)
      expect(outputs[0].bundleHash).toBeTruthy()
      expect(outputs[0].bundleHash).toMatch(/^[a-f0-9]{64}$/)
      expect(outputs[0].bundleContextHash).toBeTruthy()
      expect(outputs[0].bundleContextHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('stores promptVersionId on output', async () => {
      mockRealSummarizeResolved({
        text: 'Summary.',
        tokensIn: 100,
        tokensOut: 20,
        costUsd: 0.0005,
      })

      const run = await createTestRun('gpt-4o')
      await processTick({ runId: run.id })

      const outputs = await prisma.output.findMany({
        where: { job: { runId: run.id } },
      })
      expect(outputs).toHaveLength(1)
      // Verify the output stores the promptVersionId from the run's frozen config
      expect(outputs[0].promptVersionId).toBe(run.config.promptVersionIds.summarize)
    })
  })
})
