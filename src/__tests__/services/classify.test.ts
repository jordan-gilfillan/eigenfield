import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { classifyBatch, computeStubCategory } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'

/**
 * Integration tests for the classification service.
 *
 * These tests verify:
 * - Determinism: running stub classify twice produces identical categories
 * - Idempotence: second classify with same labelSpec results in newlyLabeled=0
 * - Version isolation: different promptVersionIds create separate labels
 * - Response shape: matches SPEC 7.9
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

describe('Classification Service', () => {
  // Track created resources for cleanup
  const createdBatchIds: string[] = []
  const createdPromptVersionIds: string[] = []
  let defaultPromptVersionId: string

  beforeEach(async () => {
    // Get or create the default classify prompt version
    const classifyPrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
      update: {},
      create: {
        stage: 'CLASSIFY',
        name: 'default-classifier',
      },
    })

    const pv = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: classifyPrompt.id,
          versionLabel: 'classify_stub_v1',
        },
      },
      update: { isActive: true },
      create: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_stub_v1',
        templateText: 'STUB: Deterministic classification based on atomStableId hash.',
        isActive: true,
      },
    })
    defaultPromptVersionId = pv.id
  })

  afterEach(async () => {
    // Clean up test data in correct order
    for (const id of createdBatchIds) {
      await prisma.messageLabel.deleteMany({
        where: { messageAtom: { importBatchId: id } },
      })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: id } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: id } })
      await prisma.importBatch.delete({ where: { id } }).catch(() => {})
    }
    createdBatchIds.length = 0

    // Clean up extra prompt versions (not the default one)
    for (const id of createdPromptVersionIds) {
      await prisma.messageLabel.deleteMany({ where: { promptVersionId: id } })
      await prisma.promptVersion.delete({ where: { id } }).catch(() => {})
    }
    createdPromptVersionIds.length = 0
  })

  describe('computeStubCategory', () => {
    it('is deterministic for the same atomStableId', () => {
      const atomStableId = 'test-atom-stable-id-123'
      const cat1 = computeStubCategory(atomStableId)
      const cat2 = computeStubCategory(atomStableId)
      expect(cat1).toBe(cat2)
    })

    it('returns one of the six core categories', () => {
      const coreCategories = ['WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER']
      // Test with various inputs
      const testIds = ['abc', 'def', 'ghi', 'jkl', 'mno', 'pqr', 'stu', 'vwx', 'yza']
      for (const id of testIds) {
        const cat = computeStubCategory(id)
        expect(coreCategories).toContain(cat)
      }
    })

    it('distributes across categories (not all same)', () => {
      // Generate many atomStableIds and verify we get different categories
      const categories = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const cat = computeStubCategory(`atom-${i}`)
        categories.add(cat)
      }
      // Should have at least 3 different categories with 100 samples
      expect(categories.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('classifyBatch', () => {
    it('classifies all atoms in an import batch', async () => {
      const content = createTestExport([
        { id: 'msg-class-1', role: 'user', text: 'Classify test', timestamp: 1705316400, conversationId: 'conv-classify-all' },
        { id: 'msg-class-2', role: 'assistant', text: 'Classify reply', timestamp: 1705316401, conversationId: 'conv-classify-all' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      expect(result.importBatchId).toBe(importResult.importBatch.id)
      expect(result.labelSpec.model).toBe('stub_v1')
      expect(result.labelSpec.promptVersionId).toBe(defaultPromptVersionId)
      expect(result.mode).toBe('stub')
      expect(result.totals.messageAtoms).toBe(2)
      expect(result.totals.labeled).toBe(2)
      expect(result.totals.newlyLabeled).toBe(2)
      expect(result.totals.skippedAlreadyLabeled).toBe(0)
    })

    it('is deterministic: running twice produces identical categories', async () => {
      const content = createTestExport([
        { id: 'msg-determ-1', role: 'user', text: 'Determinism test', timestamp: 1705316400, conversationId: 'conv-determinism' },
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
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      // Get the label
      const label1 = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'stub_v1',
          promptVersionId: defaultPromptVersionId,
        },
      })

      // Delete labels and reclassify
      await prisma.messageLabel.deleteMany({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
        },
      })

      // Second classification
      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      // Get the new label
      const label2 = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
          model: 'stub_v1',
          promptVersionId: defaultPromptVersionId,
        },
      })

      // Categories must match
      expect(label1).not.toBeNull()
      expect(label2).not.toBeNull()
      expect(label1!.category).toBe(label2!.category)
      expect(label1!.confidence).toBe(label2!.confidence)
    })

    it('is idempotent: second classify with same labelSpec results in newlyLabeled=0', async () => {
      const content = createTestExport([
        { id: 'msg-idem-1', role: 'user', text: 'Idempotent test', timestamp: 1705316400, conversationId: 'conv-idempotent' },
        { id: 'msg-idem-2', role: 'assistant', text: 'Idempotent reply', timestamp: 1705316401, conversationId: 'conv-idempotent' },
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
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      expect(result1.totals.newlyLabeled).toBe(2)
      expect(result1.totals.skippedAlreadyLabeled).toBe(0)

      // Second classification with same labelSpec
      const result2 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      expect(result2.totals.messageAtoms).toBe(2)
      expect(result2.totals.labeled).toBe(2)
      expect(result2.totals.newlyLabeled).toBe(0)
      expect(result2.totals.skippedAlreadyLabeled).toBe(2)
    })

    it('version isolation: different promptVersionIds create separate labels', async () => {
      const content = createTestExport([
        { id: 'msg-version-1', role: 'user', text: 'Version isolation test', timestamp: 1705316400, conversationId: 'conv-version-iso' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // Create a second prompt version
      const classifyPrompt = await prisma.prompt.findFirst({
        where: { stage: 'CLASSIFY' },
      })
      const pv2 = await prisma.promptVersion.create({
        data: {
          promptId: classifyPrompt!.id,
          versionLabel: 'classify_stub_v2_test',
          templateText: 'Test version 2',
          isActive: false,
        },
      })
      createdPromptVersionIds.push(pv2.id)

      // Classify with first promptVersion
      const result1 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })
      expect(result1.totals.newlyLabeled).toBe(1)

      // Classify with second promptVersion
      const result2 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: pv2.id,
        mode: 'stub',
      })
      expect(result2.totals.newlyLabeled).toBe(1)
      expect(result2.totals.skippedAlreadyLabeled).toBe(0) // Different promptVersionId

      // Verify two labels exist per atom
      const atom = await prisma.messageAtom.findFirst({
        where: { importBatchId: importResult.importBatch.id },
      })
      const labels = await prisma.messageLabel.findMany({
        where: { messageAtomId: atom!.id },
      })
      expect(labels).toHaveLength(2)
      expect(new Set(labels.map((l) => l.promptVersionId))).toEqual(
        new Set([defaultPromptVersionId, pv2.id])
      )
    })

    it('model isolation: different models create separate labels', async () => {
      const content = createTestExport([
        { id: 'msg-model-1', role: 'user', text: 'Model isolation test', timestamp: 1705316400, conversationId: 'conv-model-iso' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      // Classify with model "stub_v1"
      const result1 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })
      expect(result1.totals.newlyLabeled).toBe(1)

      // Classify with different model "stub_v1_alt" (same promptVersionId)
      const result2 = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1_alt',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })
      expect(result2.totals.newlyLabeled).toBe(1)
      expect(result2.totals.skippedAlreadyLabeled).toBe(0) // Different model

      // Verify two labels exist
      const atom = await prisma.messageAtom.findFirst({
        where: { importBatchId: importResult.importBatch.id },
      })
      const labels = await prisma.messageLabel.findMany({
        where: { messageAtomId: atom!.id },
      })
      expect(labels).toHaveLength(2)
      expect(new Set(labels.map((l) => l.model))).toEqual(
        new Set(['stub_v1', 'stub_v1_alt'])
      )
    })

    it('throws error for non-existent importBatchId', async () => {
      await expect(
        classifyBatch({
          importBatchId: 'non-existent-id',
          model: 'stub_v1',
          promptVersionId: defaultPromptVersionId,
          mode: 'stub',
        })
      ).rejects.toThrow('ImportBatch not found')
    })

    it('throws error for non-existent promptVersionId', async () => {
      const content = createTestExport([
        { id: 'msg-no-pv-1', role: 'user', text: 'No PV test', timestamp: 1705316400, conversationId: 'conv-no-pv' },
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
          model: 'stub_v1',
          promptVersionId: 'non-existent-id',
          mode: 'stub',
        })
      ).rejects.toThrow('PromptVersion not found')
    })

    it('throws error for mode=real (not implemented)', async () => {
      const content = createTestExport([
        { id: 'msg-real-1', role: 'user', text: 'Real mode test', timestamp: 1705316400, conversationId: 'conv-real-mode' },
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
          model: 'gpt-4',
          promptVersionId: defaultPromptVersionId,
          mode: 'real',
        })
      ).rejects.toThrow('NOT_IMPLEMENTED')
    })

    it('handles empty import batch gracefully', async () => {
      // Create an empty import batch directly
      const batch = await prisma.importBatch.create({
        data: {
          source: 'CHATGPT',
          originalFilename: 'empty.json',
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
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      expect(result.totals.messageAtoms).toBe(0)
      expect(result.totals.labeled).toBe(0)
      expect(result.totals.newlyLabeled).toBe(0)
      expect(result.totals.skippedAlreadyLabeled).toBe(0)
    })

    it('stores labels with correct confidence (0.5)', async () => {
      const content = createTestExport([
        { id: 'msg-conf-1', role: 'user', text: 'Confidence test', timestamp: 1705316400, conversationId: 'conv-confidence' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      const label = await prisma.messageLabel.findFirst({
        where: {
          messageAtom: { importBatchId: importResult.importBatch.id },
        },
      })

      expect(label).not.toBeNull()
      expect(label!.confidence).toBe(0.5)
    })
  })

  describe('response shape (SPEC 7.9)', () => {
    it('returns all required fields', async () => {
      const content = createTestExport([
        { id: 'msg-shape-1', role: 'user', text: 'Response shape test', timestamp: 1705316400, conversationId: 'conv-shape' },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const result = await classifyBatch({
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
        mode: 'stub',
      })

      // Verify all required fields exist
      expect(result).toHaveProperty('importBatchId')
      expect(result).toHaveProperty('labelSpec')
      expect(result.labelSpec).toHaveProperty('model')
      expect(result.labelSpec).toHaveProperty('promptVersionId')
      expect(result).toHaveProperty('mode')
      expect(result).toHaveProperty('totals')
      expect(result.totals).toHaveProperty('messageAtoms')
      expect(result.totals).toHaveProperty('labeled')
      expect(result.totals).toHaveProperty('newlyLabeled')
      expect(result.totals).toHaveProperty('skippedAlreadyLabeled')

      // Verify types
      expect(typeof result.importBatchId).toBe('string')
      expect(typeof result.labelSpec.model).toBe('string')
      expect(typeof result.labelSpec.promptVersionId).toBe('string')
      expect(typeof result.mode).toBe('string')
      expect(typeof result.totals.messageAtoms).toBe('number')
      expect(typeof result.totals.labeled).toBe('number')
      expect(typeof result.totals.newlyLabeled).toBe('number')
      expect(typeof result.totals.skippedAlreadyLabeled).toBe('number')
    })
  })
})
