/**
 * Integration tests for pricing book + run pricing snapshot (PR-3b0.1)
 *
 * Tests:
 * - Run creation includes pricingSnapshot in configJson
 * - Stub model gets zero-rate snapshot
 * - Unknown model returns 400 UNKNOWN_MODEL_PRICING
 * - pricingSnapshot fields match rate table
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../db'
import { createRun } from '../run'
import { UnknownModelPricingError } from '../../llm/errors'

describe('pricing integration', () => {
  let testImportBatchId: string
  let testFilterProfileId: string
  let testClassifyPromptVersionId: string
  let testSummarizePromptVersionId: string
  let testClassifyPromptId: string
  let testSummarizePromptId: string
  let testUniqueId: string

  beforeEach(async () => {
    testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    const importBatch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'test-pricing.json',
        fileSizeBytes: 500,
        timezone: 'America/Los_Angeles',
        statsJson: {
          message_count: 4,
          day_count: 1,
          coverage_start: '2024-03-01',
          coverage_end: '2024-03-01',
        },
      },
    })
    testImportBatchId = importBatch.id

    const filterProfile = await prisma.filterProfile.create({
      data: {
        name: `Pricing Test Filter ${testUniqueId}`,
        mode: 'EXCLUDE',
        categories: ['MEDICAL'],
      },
    })
    testFilterProfileId = filterProfile.id

    const classifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Pricing Classify ${testUniqueId}` },
    })
    testClassifyPromptId = classifyPrompt.id

    const classifyVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPrompt.id,
        versionLabel: 'test-v1',
        templateText: 'Classify',
        isActive: true,
      },
    })
    testClassifyPromptVersionId = classifyVersion.id

    const summarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Pricing Summarize ${testUniqueId}` },
    })
    testSummarizePromptId = summarizePrompt.id

    const summarizeVersion = await prisma.promptVersion.create({
      data: {
        promptId: summarizePrompt.id,
        versionLabel: 'test-v1',
        templateText: 'Summarize',
        isActive: true,
      },
    })
    testSummarizePromptVersionId = summarizeVersion.id

    // Create a test atom with label on day 2024-03-01
    const atom = await prisma.messageAtom.create({
      data: {
        importBatchId: testImportBatchId,
        source: 'CHATGPT',
        role: 'USER',
        text: 'pricing test message',
        textHash: `text-hash-pricing-${testUniqueId}`,
        timestampUtc: new Date('2024-03-01T10:00:00Z'),
        dayDate: new Date('2024-03-01'),
        atomStableId: `pricing-atom-${testUniqueId}`,
      },
    })

    await prisma.messageLabel.create({
      data: {
        messageAtomId: atom.id,
        model: 'stub_v1',
        promptVersionId: testClassifyPromptVersionId,
        category: 'WORK',
        confidence: 0.8,
      },
    })
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

  describe('run creation pricingSnapshot', () => {
    it('includes pricingSnapshot in configJson for stub model', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-03-01',
        endDate: '2024-03-01',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'stub_summarizer_v1',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(result.config.pricingSnapshot).toBeDefined()
      const snap = result.config.pricingSnapshot!
      expect(snap.model).toBe('stub_summarizer_v1')
      expect(snap.inputPer1MUsd).toBe(0)
      expect(snap.outputPer1MUsd).toBe(0)
      expect(snap.capturedAt).toBeDefined()
    })

    it('includes pricingSnapshot with real rates for gpt-4o', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-03-01',
        endDate: '2024-03-01',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(result.config.pricingSnapshot).toBeDefined()
      const snap = result.config.pricingSnapshot!
      expect(snap.provider).toBe('openai')
      expect(snap.model).toBe('gpt-4o')
      expect(snap.inputPer1MUsd).toBe(2.5)
      expect(snap.outputPer1MUsd).toBe(10.0)
      expect(snap.cachedInputPer1MUsd).toBe(1.25)
      expect(new Date(snap.capturedAt).getTime()).not.toBeNaN()
    })

    it('includes pricingSnapshot with real rates for claude-sonnet-4-5', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-03-01',
        endDate: '2024-03-01',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'claude-sonnet-4-5',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      expect(result.config.pricingSnapshot).toBeDefined()
      const snap = result.config.pricingSnapshot!
      expect(snap.provider).toBe('anthropic')
      expect(snap.model).toBe('claude-sonnet-4-5')
      expect(snap.inputPer1MUsd).toBe(3.0)
      expect(snap.outputPer1MUsd).toBe(15.0)
    })

    it('pricingSnapshot is persisted in DB configJson', async () => {
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-03-01',
        endDate: '2024-03-01',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })

      // Verify the DB record has pricingSnapshot
      const run = await prisma.run.findUnique({ where: { id: result.id } })
      expect(run).toBeDefined()
      const config = run!.configJson as Record<string, unknown>
      const snap = config.pricingSnapshot as Record<string, unknown>
      expect(snap).toBeDefined()
      expect(snap.provider).toBe('openai')
      expect(snap.model).toBe('gpt-4o')
      expect(snap.inputPer1MUsd).toBe(2.5)
      expect(snap.outputPer1MUsd).toBe(10.0)
    })

    it('throws UnknownModelPricingError for unknown non-stub model', async () => {
      await expect(
        createRun({
          importBatchId: testImportBatchId,
          startDate: '2024-03-01',
          endDate: '2024-03-01',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'unknown-model-xyz',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
      ).rejects.toThrow(UnknownModelPricingError)
    })

    it('UnknownModelPricingError has correct code', async () => {
      try {
        await createRun({
          importBatchId: testImportBatchId,
          startDate: '2024-03-01',
          endDate: '2024-03-01',
          sources: ['chatgpt'],
          filterProfileId: testFilterProfileId,
          model: 'nonexistent-model',
          labelSpec: {
            model: 'stub_v1',
            promptVersionId: testClassifyPromptVersionId,
          },
        })
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(UnknownModelPricingError)
        expect((err as UnknownModelPricingError).code).toBe('UNKNOWN_MODEL_PRICING')
      }
    })

    it('pricingSnapshot capturedAt is close to current time', async () => {
      const before = new Date()
      const result = await createRun({
        importBatchId: testImportBatchId,
        startDate: '2024-03-01',
        endDate: '2024-03-01',
        sources: ['chatgpt'],
        filterProfileId: testFilterProfileId,
        model: 'gpt-4o',
        labelSpec: {
          model: 'stub_v1',
          promptVersionId: testClassifyPromptVersionId,
        },
      })
      const after = new Date()

      const capturedAt = new Date(result.config.pricingSnapshot!.capturedAt)
      expect(capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(capturedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })
})
