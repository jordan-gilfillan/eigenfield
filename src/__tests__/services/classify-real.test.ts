import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '../../lib/db'
import { classifyBatch, parseClassifyOutput } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'
import { LlmBadOutputError, BudgetExceededError } from '../../lib/llm'
import * as llmModule from '../../lib/llm'

/**
 * Integration tests for real-mode classification (dry-run LLM).
 *
 * These tests verify:
 * - Real mode writes labels via callLlm dry-run path
 * - Idempotence: re-running skips existing labels
 * - Determinism: categories are stable across runs
 * - Missing promptVersionId → error
 * - Budget exceeded → BUDGET_EXCEEDED error
 * - LLM output parsing + validation
 */

// Test data: minimal valid ChatGPT export
function createTestExport(messages: Array<{
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  conversationId?: string
}>) {
  const mapping: Record<string, unknown> = {}

  messages.forEach((msg, i) => {
    mapping[`node-${i}`] = {
      id: `node-${i}`,
      message: {
        id: msg.id,
        author: { role: msg.role },
        create_time: msg.timestamp,
        content: {
          content_type: 'text',
          parts: [msg.text],
        },
      },
      parent: i > 0 ? `node-${i - 1}` : null,
      children: i < messages.length - 1 ? [`node-${i + 1}`] : [],
    }
  })

  return JSON.stringify([
    {
      title: 'Test Conversation',
      create_time: messages[0]?.timestamp ?? 1705316400,
      update_time: messages[messages.length - 1]?.timestamp ?? 1705316400,
      mapping,
      conversation_id: messages[0]?.conversationId ?? 'conv-test',
    },
  ])
}

describe('Classification Service — Real Mode (dry-run)', () => {
  const createdBatchIds: string[] = []
  const createdPromptVersionIds: string[] = []
  let realPromptVersionId: string
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    // Ensure dry-run mode (default)
    delete process.env.LLM_MODE
    delete process.env.LLM_MAX_USD_PER_RUN
    delete process.env.LLM_MAX_USD_PER_DAY
    process.env.LLM_MIN_DELAY_MS = '0' // No delay in tests

    // Get or create the classify prompt
    const classifyPrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
      update: {},
      create: {
        stage: 'CLASSIFY',
        name: 'default-classifier',
      },
    })

    // Create a real classify prompt version
    const pv = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: classifyPrompt.id,
          versionLabel: 'classify_real_v1_test',
        },
      },
      update: {},
      create: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1_test',
        templateText: 'Classify the message into a category. Respond with JSON: {"category":"<CAT>","confidence":<0-1>}',
        isActive: false,
      },
    })
    realPromptVersionId = pv.id
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()

    // Clean up test data in correct order
    for (const id of createdBatchIds) {
      await prisma.classifyRun.deleteMany({ where: { importBatchId: id } })
      await prisma.messageLabel.deleteMany({
        where: { messageAtom: { importBatchId: id } },
      })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: id } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: id } })
      await prisma.importBatch.delete({ where: { id } }).catch(() => {})
    }
    createdBatchIds.length = 0

    for (const id of createdPromptVersionIds) {
      await prisma.classifyRun.deleteMany({ where: { promptVersionId: id } })
      await prisma.messageLabel.deleteMany({ where: { promptVersionId: id } })
      await prisma.promptVersion.delete({ where: { id } }).catch(() => {})
    }
    createdPromptVersionIds.length = 0
  })

  describe('classifyBatch mode=real', () => {
    it('writes labels for unlabeled atoms via dry-run LLM', async () => {
      const content = createTestExport([
        { id: 'msg-real-1', role: 'user', text: 'Help me with work', timestamp: 1705316400, conversationId: 'conv-real-1' },
        { id: 'msg-real-2', role: 'assistant', text: 'Sure, I can help', timestamp: 1705316401, conversationId: 'conv-real-1' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      expect(result.mode).toBe('real')
      expect(result.totals.messageAtoms).toBe(2)
      expect(result.totals.newlyLabeled).toBe(2)
      expect(result.totals.skippedAlreadyLabeled).toBe(0)
      expect(result.totals.labeled).toBe(2)
      expect(result.labelSpec.model).toBe('gpt-4o')
      expect(result.labelSpec.promptVersionId).toBe(realPromptVersionId)

      // Verify labels in DB
      const labels = await prisma.messageLabel.findMany({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
        },
      })
      expect(labels).toHaveLength(2)

      // Verify each label has valid category and confidence
      const validCategories = [
        'WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER',
        'MEDICAL', 'MENTAL_HEALTH', 'ADDICTION_RECOVERY', 'INTIMACY',
        'FINANCIAL', 'LEGAL', 'EMBARRASSING',
      ]
      for (const label of labels) {
        expect(validCategories).toContain(label.category)
        expect(label.confidence).toBe(0.7) // dry-run always returns 0.7
        expect(label.model).toBe('gpt-4o')
        expect(label.promptVersionId).toBe(realPromptVersionId)
      }
    })

    it('re-running skips existing labels (idempotent)', async () => {
      const content = createTestExport([
        { id: 'msg-idem-real-1', role: 'user', text: 'Idempotent test', timestamp: 1705316400, conversationId: 'conv-idem-real' },
        { id: 'msg-idem-real-2', role: 'assistant', text: 'Idempotent reply', timestamp: 1705316401, conversationId: 'conv-idem-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // First classification
      const result1 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })
      expect(result1.totals.newlyLabeled).toBe(2)

      // Second classification with same labelSpec
      const result2 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })
      expect(result2.totals.newlyLabeled).toBe(0)
      expect(result2.totals.skippedAlreadyLabeled).toBe(2)
      expect(result2.totals.labeled).toBe(2)
    })

    it('deterministic categories stable across runs', async () => {
      const content = createTestExport([
        { id: 'msg-det-real-1', role: 'user', text: 'Determinism test real', timestamp: 1705316400, conversationId: 'conv-det-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // First classification
      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      const label1 = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
        },
      })

      // Delete and reclassify
      await prisma.messageLabel.deleteMany({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
        },
      })

      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      const label2 = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
        },
      })

      expect(label1).not.toBeNull()
      expect(label2).not.toBeNull()
      expect(label1!.category).toBe(label2!.category)
      expect(label1!.confidence).toBe(label2!.confidence)
    })

    it('missing promptVersionId → 400 validation error', async () => {
      const content = createTestExport([
        { id: 'msg-nopv-real-1', role: 'user', text: 'No PV test', timestamp: 1705316400, conversationId: 'conv-nopv-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      await expect(
        classifyBatch({
          importBatchId: importResult.importBatch.id,
          model: 'gpt-4o',
          promptVersionId: 'non-existent-pv-id',
          mode: 'real',
        })
      ).rejects.toThrow('PromptVersion not found')
    })

    it('budget exceeded triggers BUDGET_EXCEEDED error', async () => {
      const content = createTestExport([
        { id: 'msg-budget-1', role: 'user', text: 'Budget test', timestamp: 1705316400, conversationId: 'conv-budget' },
        { id: 'msg-budget-2', role: 'assistant', text: 'Budget reply', timestamp: 1705316401, conversationId: 'conv-budget' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // Set budget cap very low — lower than the estimated per-call cost of $0.001
      process.env.LLM_MAX_USD_PER_RUN = '0.0001'

      await expect(
        classifyBatch({
          importBatchId: importResult.importBatch.id,
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
          mode: 'real',
        })
      ).rejects.toThrow(BudgetExceededError)
    })

    it('response shape matches spec 7.9', async () => {
      const content = createTestExport([
        { id: 'msg-shape-real-1', role: 'user', text: 'Shape test real', timestamp: 1705316400, conversationId: 'conv-shape-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      expect(result).toHaveProperty('importBatchId')
      expect(result).toHaveProperty('labelSpec')
      expect(result.labelSpec).toHaveProperty('model')
      expect(result.labelSpec).toHaveProperty('promptVersionId')
      expect(result).toHaveProperty('mode', 'real')
      expect(result).toHaveProperty('totals')
      expect(result.totals).toHaveProperty('messageAtoms')
      expect(result.totals).toHaveProperty('labeled')
      expect(result.totals).toHaveProperty('newlyLabeled')
      expect(result.totals).toHaveProperty('skippedAlreadyLabeled')
    })

    it('handles empty import batch gracefully', async () => {
      const batch = await prisma.importBatch.create({
        data: {
          source: 'CHATGPT',
          originalFilename: 'empty-real.json',
          fileSizeBytes: 0,
          timezone: 'UTC',
          statsJson: {
            message_count: 0,
            day_count: 0,
            coverage_start: '',
            coverage_end: '',
            per_source_counts: {},
          },
        },
      })
      createdBatchIds.push(batch.id)

      const result = await classifyBatch({
        importBatchId: batch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      expect(result.totals.messageAtoms).toBe(0)
      expect(result.totals.labeled).toBe(0)
      expect(result.totals.newlyLabeled).toBe(0)
    })

    it('real mode labels are isolated from stub mode labels', async () => {
      const content = createTestExport([
        { id: 'msg-iso-1', role: 'user', text: 'Isolation test', timestamp: 1705316400, conversationId: 'conv-iso' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // Classify with stub mode (need stub prompt version)
      const classifyPrompt = await prisma.prompt.findFirst({
        where: { stage: 'CLASSIFY' },
      })
      const stubPv = await prisma.promptVersion.upsert({
        where: {
          promptId_versionLabel: {
            promptId: classifyPrompt!.id,
            versionLabel: 'classify_stub_v1',
          },
        },
        update: { isActive: true },
        create: {
          promptId: classifyPrompt!.id,
          versionLabel: 'classify_stub_v1',
          templateText: 'STUB',
          isActive: true,
        },
      })

      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: stubPv.id,
        mode: 'stub',
      })

      // Now classify with real mode
      const realResult = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      // Should label as new (different model+promptVersion)
      expect(realResult.totals.newlyLabeled).toBe(1)

      // Verify both labels exist
      const atom = await prisma.messageAtom.findFirst({
        where: { importBatchId: importResult.importBatch.id },
      })
      const labels = await prisma.messageLabel.findMany({
        where: { messageAtomId: atom!.id },
      })
      expect(labels).toHaveLength(2)
      expect(new Set(labels.map((l) => l.model))).toEqual(
        new Set(['stub_v1', 'gpt-4o'])
      )
    })

    it('stores confidence=0.7 from dry-run LLM', async () => {
      const content = createTestExport([
        { id: 'msg-conf-real-1', role: 'user', text: 'Confidence test', timestamp: 1705316400, conversationId: 'conv-conf-real' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      const label = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
        },
      })
      expect(label).not.toBeNull()
      expect(label!.confidence).toBe(0.7)
    })

    it('continues when one atom has bad output category and reports warning stats', async () => {
      const content = createTestExport([
        { id: 'msg-badcat-1', role: 'user', text: 'First atom', timestamp: 1705316400, conversationId: 'conv-badcat' },
        { id: 'msg-badcat-2', role: 'assistant', text: 'Second atom', timestamp: 1705316401, conversationId: 'conv-badcat' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      let callCount = 0
      vi.spyOn(llmModule, 'callLlm').mockImplementation(async () => {
        callCount += 1
        if (callCount === 1) {
          return {
            text: '{"category":"GALACTIC","confidence":0.61}',
            tokensIn: 10,
            tokensOut: 10,
            costUsd: 0.001,
            dryRun: false,
          }
        }
        return {
          text: '{"category":"WORK","confidence":0.8}',
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.001,
          dryRun: false,
        }
      })

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'gpt-4o',
        promptVersionId: realPromptVersionId,
        mode: 'real',
      })

      expect(result.totals.newlyLabeled).toBe(1)
      expect(result.warnings?.skippedBadOutput).toBe(1)
      expect(result.warnings?.badCategorySamples).toContain('GALACTIC')

      const labels = await prisma.messageLabel.findMany({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'gpt-4o',
          promptVersionId: realPromptVersionId,
        },
      })
      expect(labels).toHaveLength(1)
      expect(labels[0].category).toBe('WORK')
    })
  })

  describe('parseClassifyOutput', () => {
    it('parses valid JSON with category and confidence', () => {
      const result = parseClassifyOutput('{"category":"WORK","confidence":0.85}')
      expect(result.category).toBe('WORK')
      expect(result.confidence).toBe(0.85)
    })

    it('accepts all valid categories', () => {
      const categories = [
        'WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER',
        'MEDICAL', 'MENTAL_HEALTH', 'ADDICTION_RECOVERY', 'INTIMACY',
        'FINANCIAL', 'LEGAL', 'EMBARRASSING',
      ]
      for (const cat of categories) {
        const result = parseClassifyOutput(`{"category":"${cat}","confidence":0.5}`)
        expect(result.category).toBe(cat)
      }
    })

    it('normalizes lowercase category to uppercase', () => {
      const result = parseClassifyOutput('{"category":"work","confidence":0.5}')
      expect(result.category).toBe('WORK')
    })

    it('normalizes mixed-case category to uppercase', () => {
      const result = parseClassifyOutput('{"category":"Mental_Health","confidence":0.5}')
      expect(result.category).toBe('MENTAL_HEALTH')
    })

    it('accepts confidence at boundaries (0.0 and 1.0)', () => {
      const r1 = parseClassifyOutput('{"category":"WORK","confidence":0.0}')
      expect(r1.confidence).toBe(0.0)
      const r2 = parseClassifyOutput('{"category":"WORK","confidence":1.0}')
      expect(r2.confidence).toBe(1.0)
    })

    it('handles whitespace around JSON', () => {
      const result = parseClassifyOutput('  \n{"category":"WORK","confidence":0.5}\n  ')
      expect(result.category).toBe('WORK')
    })

    it('parses fenced JSON output', () => {
      const result = parseClassifyOutput('```json\n{"category":"WORK","confidence":0.73}\n```')
      expect(result.category).toBe('WORK')
      expect(result.confidence).toBe(0.73)
    })

    it('parses JSON with leading text', () => {
      const result = parseClassifyOutput('Here is the classification:\n{"category":"LEGAL","confidence":0.61}')
      expect(result.category).toBe('LEGAL')
      expect(result.confidence).toBe(0.61)
    })

    it('parses JSON with trailing text', () => {
      const result = parseClassifyOutput('{"category":"PERSONAL","confidence":0.54}\nThanks!')
      expect(result.category).toBe('PERSONAL')
      expect(result.confidence).toBe(0.54)
    })

    it('maps space/hyphen category variants safely', () => {
      const mental = parseClassifyOutput('{"category":"mental health","confidence":0.77}')
      expect(mental.category).toBe('MENTAL_HEALTH')

      const recovery = parseClassifyOutput('{"category":"addiction-recovery","confidence":0.77}')
      expect(recovery.category).toBe('ADDICTION_RECOVERY')
    })

    it('maps explicit ethical aliases to canonical category', () => {
      const aliases = ['ETHICAL', 'ETHICS', 'MORAL', 'VALUES']
      for (const alias of aliases) {
        const result = parseClassifyOutput(`{"category":"${alias}","confidence":0.66}`)
        expect(result.category).toBe('PERSONAL')
        expect(result.aliasedFrom).toBe(alias)
      }
    })

    it('throws LlmBadOutputError for invalid JSON', () => {
      expect(() => parseClassifyOutput('not json')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('not json')).toThrow('not valid JSON')
    })

    it('throws LlmBadOutputError for JSON array', () => {
      expect(() => parseClassifyOutput('["WORK"]')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('["WORK"]')).toThrow('not a JSON object')
    })

    it('throws LlmBadOutputError for missing category', () => {
      expect(() => parseClassifyOutput('{"confidence":0.5}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"confidence":0.5}')).toThrow('category')
    })

    it('throws LlmBadOutputError for invalid category value', () => {
      expect(() => parseClassifyOutput('{"category":"INVALID","confidence":0.5}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"category":"INVALID","confidence":0.5}')).toThrow('invalid category')
    })

    it('throws LlmBadOutputError for missing confidence', () => {
      expect(() => parseClassifyOutput('{"category":"WORK"}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"category":"WORK"}')).toThrow('confidence')
    })

    it('throws LlmBadOutputError for non-numeric confidence', () => {
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":"high"}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":"high"}')).toThrow('confidence')
    })

    it('throws LlmBadOutputError for confidence < 0', () => {
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":-0.1}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":-0.1}')).toThrow('out of range')
    })

    it('throws LlmBadOutputError for confidence > 1', () => {
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":1.5}')).toThrow(LlmBadOutputError)
      expect(() => parseClassifyOutput('{"category":"WORK","confidence":1.5}')).toThrow('out of range')
    })

    it('includes rawOutput in error details', () => {
      try {
        parseClassifyOutput('bad json')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmBadOutputError)
        const e = err as LlmBadOutputError
        expect(e.code).toBe('LLM_BAD_OUTPUT')
        expect(e.details?.rawOutput).toBe('bad json')
      }
    })

    it('invalid wrapped JSON still throws with helpful details', () => {
      const raw = '```json\n{"category":"WORK","confidence":}\n```'
      try {
        parseClassifyOutput(raw)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmBadOutputError)
        const e = err as LlmBadOutputError
        expect(e.message).toContain('not valid JSON')
        expect(e.details?.rawOutput).toBe(raw)
        expect(e.details?.candidatesTried).toBeGreaterThan(0)
        expect(Array.isArray(e.details?.parseErrors)).toBe(true)
      }
    })

    it('LlmBadOutputError for null input', () => {
      expect(() => parseClassifyOutput('null')).toThrow(LlmBadOutputError)
    })
  })
})
