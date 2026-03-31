import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { classifyBatch } from '../../lib/services/classify'
import { importExport } from '../../lib/services/import'
import { resolveDefaultClassifyPromptVersion } from '../../lib/services/prompt-version-defaults'

import { createTestExport } from '../fixtures/export-factories'

/**
 * Integration tests for ClassifyRun stats persistence and last-classify retrieval.
 *
 * These tests verify:
 * - classifyBatch() persists a ClassifyRun row on success
 * - ClassifyRun contains correct totals matching the classify result
 * - Multiple classifies for same labelSpec produce multiple ClassifyRun rows
 * - Last-classify query returns most recent row for matching labelSpec
 * - Last-classify returns hasStats=false when no rows match
 */

describe('ClassifyRun stats persistence', () => {
  const createdBatchIds: string[] = []
  let defaultPromptVersionId: string

  beforeEach(async () => {
    const pv = await resolveDefaultClassifyPromptVersion('stub')
    defaultPromptVersionId = pv.id
  })

  afterEach(async () => {
    for (const id of createdBatchIds) {
      await prisma.classifyRun.deleteMany({
        where: { importBatchId: id },
      })
      await prisma.messageLabel.deleteMany({
        where: { messageAtom: { importBatchId: id } },
      })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: id } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: id } })
      await prisma.importBatch.delete({ where: { id } }).catch(() => {})
    }
    createdBatchIds.length = 0
  })

  it('persists a ClassifyRun row on classify success', async () => {
    const content = createTestExport([
      { id: 'msg-stats-1', role: 'user', text: 'Stats test 1', timestamp: 1705316400, conversationId: 'conv-stats-persist' },
      { id: 'msg-stats-2', role: 'assistant', text: 'Stats reply', timestamp: 1705316401, conversationId: 'conv-stats-persist' },
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

    // Verify ClassifyRun was persisted
    const classifyRuns = await prisma.classifyRun.findMany({
      where: {
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
      },
    })

    expect(classifyRuns).toHaveLength(1)
    const cr = classifyRuns[0]
    expect(cr.mode).toBe('stub')
    expect(cr.totalAtoms).toBe(result.totals.messageAtoms)
    expect(cr.newlyLabeled).toBe(result.totals.newlyLabeled)
    expect(cr.skippedAlreadyLabeled).toBe(result.totals.skippedAlreadyLabeled)
    expect(cr.labeledTotal).toBe(result.totals.labeled)
  })

  it('ClassifyRun totals match classify result exactly', async () => {
    const content = createTestExport([
      { id: 'msg-match-1', role: 'user', text: 'Match test', timestamp: 1705316400, conversationId: 'conv-match' },
      { id: 'msg-match-2', role: 'assistant', text: 'Match reply', timestamp: 1705316401, conversationId: 'conv-match' },
      { id: 'msg-match-3', role: 'user', text: 'Match follow-up', timestamp: 1705316402, conversationId: 'conv-match' },
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

    expect(result.totals.messageAtoms).toBe(2)
    expect(result.totals.newlyLabeled).toBe(2)

    const cr = await prisma.classifyRun.findFirst({
      where: { importBatchId: importResult.importBatch.id },
    })

    expect(cr).not.toBeNull()
    expect(cr!.totalAtoms).toBe(2)
    expect(cr!.newlyLabeled).toBe(2)
    expect(cr!.skippedAlreadyLabeled).toBe(0)
    expect(cr!.labeledTotal).toBe(2)
  })

  it('assistant-only batch persists a zero-total ClassifyRun', async () => {
    const content = createTestExport([
      { id: 'msg-assistant-stats-1', role: 'assistant', text: 'Assistant stats 1', timestamp: 1705316400, conversationId: 'conv-assistant-stats' },
      { id: 'msg-assistant-stats-2', role: 'assistant', text: 'Assistant stats 2', timestamp: 1705316401, conversationId: 'conv-assistant-stats' },
    ])

    const importResult = await importExport({
      content,
      filename: 'assistant-stats.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    const result = await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    expect(result.totals.messageAtoms).toBe(0)
    expect(result.totals.labeled).toBe(0)
    expect(result.totals.newlyLabeled).toBe(0)
    expect(result.totals.skippedAlreadyLabeled).toBe(0)

    const cr = await prisma.classifyRun.findFirst({
      where: { importBatchId: importResult.importBatch.id },
    })

    expect(cr).not.toBeNull()
    expect(cr!.totalAtoms).toBe(0)
    expect(cr!.newlyLabeled).toBe(0)
    expect(cr!.labeledTotal).toBe(0)
  })

  it('second classify creates a new ClassifyRun row (idempotent labels, new stats row)', async () => {
    const content = createTestExport([
      { id: 'msg-idem-stats-1', role: 'user', text: 'Idem stats test', timestamp: 1705316400, conversationId: 'conv-idem-stats' },
    ])

    const importResult = await importExport({
      content,
      filename: 'test.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    // First classify
    await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    // Second classify (idempotent — all already labeled)
    const result2 = await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    expect(result2.totals.newlyLabeled).toBe(0)
    expect(result2.totals.skippedAlreadyLabeled).toBe(1)

    // Two ClassifyRun rows should exist
    const classifyRuns = await prisma.classifyRun.findMany({
      where: { importBatchId: importResult.importBatch.id },
      orderBy: { createdAt: 'asc' },
    })

    expect(classifyRuns).toHaveLength(2)

    // First run: newlyLabeled=1
    expect(classifyRuns[0].newlyLabeled).toBe(1)
    expect(classifyRuns[0].skippedAlreadyLabeled).toBe(0)

    // Second run: newlyLabeled=0, skipped=1
    expect(classifyRuns[1].newlyLabeled).toBe(0)
    expect(classifyRuns[1].skippedAlreadyLabeled).toBe(1)
  })

  it('last ClassifyRun query returns most recent for matching labelSpec', async () => {
    const content = createTestExport([
      { id: 'msg-last-1', role: 'user', text: 'Last test', timestamp: 1705316400, conversationId: 'conv-last' },
    ])

    const importResult = await importExport({
      content,
      filename: 'test.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    // Two classifies
    await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })
    await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    // Query for "last" — should get the most recent one
    const last = await prisma.classifyRun.findFirst({
      where: {
        importBatchId: importResult.importBatch.id,
        model: 'stub_v1',
        promptVersionId: defaultPromptVersionId,
      },
      orderBy: { createdAt: 'desc' },
    })

    expect(last).not.toBeNull()
    // The second classify has newlyLabeled=0 (all already labeled)
    expect(last!.newlyLabeled).toBe(0)
    expect(last!.skippedAlreadyLabeled).toBe(1)
  })

  it('no ClassifyRun exists when labelSpec does not match', async () => {
    const content = createTestExport([
      { id: 'msg-nomatch-1', role: 'user', text: 'No match test', timestamp: 1705316400, conversationId: 'conv-nomatch' },
    ])

    const importResult = await importExport({
      content,
      filename: 'test.json',
      fileSizeBytes: content.length,
    })
    createdBatchIds.push(importResult.importBatch.id)

    // Classify with stub_v1
    await classifyBatch({
      importBatchId: importResult.importBatch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    // Query with different model — should find nothing
    const last = await prisma.classifyRun.findFirst({
      where: {
        importBatchId: importResult.importBatch.id,
        model: 'different_model',
        promptVersionId: defaultPromptVersionId,
      },
    })

    expect(last).toBeNull()
  })

  it('empty batch classify still persists ClassifyRun', async () => {
    const batch = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'empty-stats.json',
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

    await classifyBatch({
      importBatchId: batch.id,
      model: 'stub_v1',
      promptVersionId: defaultPromptVersionId,
      mode: 'stub',
    })

    const cr = await prisma.classifyRun.findFirst({
      where: { importBatchId: batch.id },
    })

    expect(cr).not.toBeNull()
    expect(cr!.totalAtoms).toBe(0)
    expect(cr!.newlyLabeled).toBe(0)
    expect(cr!.labeledTotal).toBe(0)
  })
})
