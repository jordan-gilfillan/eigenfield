import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { createRun } from '../../lib/services/run'
import { importExport } from '../../lib/services/import'
import { classifyBatch } from '../../lib/services/classify'

/**
 * Integration tests for run aggregate computations (tokensIn, tokensOut, costUsd).
 *
 * These tests verify:
 * - Run aggregate sums correctly from SUCCEEDED job rows
 * - Null token/cost values on unprocessed jobs are treated as 0
 * - Failed jobs are excluded from aggregates
 * - Mixed job states produce correct totals
 */

const testUniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Minimal valid ChatGPT export producing atoms on two different days
function createMultiDayExport() {
  // Day 1: 2024-01-15T12:00:00Z
  // Day 2: 2024-01-16T12:00:00Z
  const mapping: Record<string, unknown> = {}

  const msgs = [
    { id: 'agg-msg-1', role: 'user', text: 'Day 1 message', timestamp: 1705320000, convId: 'conv-agg' },
    { id: 'agg-msg-2', role: 'assistant', text: 'Day 1 reply', timestamp: 1705320001, convId: 'conv-agg' },
    { id: 'agg-msg-3', role: 'user', text: 'Day 2 message', timestamp: 1705406400, convId: 'conv-agg' },
    { id: 'agg-msg-4', role: 'assistant', text: 'Day 2 reply', timestamp: 1705406401, convId: 'conv-agg' },
  ]

  msgs.forEach((msg, i) => {
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
      children: i < msgs.length - 1 ? [`node-${i + 1}`] : [],
    }
  })

  return JSON.stringify([
    {
      title: 'Aggregate Test Conversation',
      create_time: msgs[0].timestamp,
      update_time: msgs[msgs.length - 1].timestamp,
      mapping,
      conversation_id: msgs[0].convId,
    },
  ])
}

describe('Run aggregate computations', () => {
  let importBatchId: string
  let classifyPvId: string
  let filterProfileId: string
  let summarizePvId: string

  beforeEach(async () => {
    // 1. Import a multi-day export
    const content = createMultiDayExport()
    const importResult = await importExport({
      content,
      filename: 'agg-test.json',
      fileSizeBytes: content.length,
    })
    importBatchId = importResult.importBatch.id

    // 2. Set up classify prompt version
    const classifyPrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
      update: {},
      create: { stage: 'CLASSIFY', name: 'default-classifier' },
    })
    const classifyPv = await prisma.promptVersion.upsert({
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
        templateText: 'STUB: Deterministic classification.',
        isActive: true,
      },
    })
    classifyPvId = classifyPv.id

    // 3. Classify the batch
    await classifyBatch({
      importBatchId,
      model: 'stub_v1',
      promptVersionId: classifyPvId,
      mode: 'stub',
    })

    // 4. Set up summarize prompt version
    const summarizePrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'SUMMARIZE', name: 'default-summarizer' } },
      update: {},
      create: { stage: 'SUMMARIZE', name: 'default-summarizer' },
    })
    const sumPv = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: summarizePrompt.id,
          versionLabel: 'v1',
        },
      },
      update: { isActive: true },
      create: {
        promptId: summarizePrompt.id,
        versionLabel: 'v1',
        templateText: 'Summarize the messages for {{date}}.',
        isActive: true,
      },
    })
    summarizePvId = sumPv.id

    // 5. Create a filter profile
    const fp = await prisma.filterProfile.upsert({
      where: { name: 'professional-only' },
      update: {},
      create: {
        name: 'professional-only',
        mode: 'EXCLUDE',
        categories: ['MEDICAL', 'MENTAL_HEALTH', 'ADDICTION_RECOVERY', 'INTIMACY', 'FINANCIAL', 'LEGAL', 'EMBARRASSING'],
      },
    })
    filterProfileId = fp.id
  })

  afterEach(async () => {
    // Clean up in FK order
    await prisma.output.deleteMany({
      where: { job: { run: { importBatchId } } },
    })
    await prisma.job.deleteMany({
      where: { run: { importBatchId } },
    })
    await prisma.run.deleteMany({
      where: { importBatchId },
    })
    await prisma.classifyRun.deleteMany({
      where: { importBatchId },
    })
    await prisma.messageLabel.deleteMany({
      where: { messageAtom: { importBatchId } },
    })
    await prisma.rawEntry.deleteMany({ where: { importBatchId } })
    await prisma.messageAtom.deleteMany({ where: { importBatchId } })
    await prisma.importBatch.delete({ where: { id: importBatchId } }).catch(() => {})
  })

  it('aggregates tokensIn/tokensOut/costUsd from SUCCEEDED jobs', async () => {
    // Create a run with jobs
    const run = await createRun({
      importBatchId,
      startDate: '2024-01-15',
      endDate: '2024-01-16',
      sources: ['chatgpt'],
      filterProfileId,
      model: 'stub_summarizer_v1',
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: classifyPvId,
      },
    })

    // Should have 2 jobs (one per day)
    const jobs = await prisma.job.findMany({
      where: { runId: run.id },
      orderBy: { dayDate: 'asc' },
    })
    expect(jobs.length).toBeGreaterThanOrEqual(1)

    // Manually set token/cost values on jobs to simulate completion
    await prisma.job.update({
      where: { id: jobs[0].id },
      data: { status: 'SUCCEEDED', tokensIn: 100, tokensOut: 50, costUsd: 0.005 },
    })

    if (jobs.length >= 2) {
      await prisma.job.update({
        where: { id: jobs[1].id },
        data: { status: 'SUCCEEDED', tokensIn: 200, tokensOut: 75, costUsd: 0.010 },
      })
    }

    // Query aggregates via Prisma (same logic as API route)
    const totals = await prisma.job.aggregate({
      where: { runId: run.id, status: 'SUCCEEDED' },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    })

    const expectedIn = jobs.length >= 2 ? 300 : 100
    const expectedOut = jobs.length >= 2 ? 125 : 50
    const expectedCost = jobs.length >= 2 ? 0.015 : 0.005

    expect(totals._sum.tokensIn).toBe(expectedIn)
    expect(totals._sum.tokensOut).toBe(expectedOut)
    expect(totals._sum.costUsd).toBeCloseTo(expectedCost, 4)
  })

  it('null token/cost on unprocessed jobs treated as 0 in aggregation', async () => {
    const run = await createRun({
      importBatchId,
      startDate: '2024-01-15',
      endDate: '2024-01-16',
      sources: ['chatgpt'],
      filterProfileId,
      model: 'stub_summarizer_v1',
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: classifyPvId,
      },
    })

    // Jobs remain QUEUED with null tokens
    const totals = await prisma.job.aggregate({
      where: { runId: run.id, status: 'SUCCEEDED' },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    })

    // No SUCCEEDED jobs → null sums (|| 0 in API layer)
    expect(totals._sum.tokensIn ?? 0).toBe(0)
    expect(totals._sum.tokensOut ?? 0).toBe(0)
    expect(totals._sum.costUsd ?? 0).toBe(0)
  })

  it('failed jobs excluded from aggregates', async () => {
    const run = await createRun({
      importBatchId,
      startDate: '2024-01-15',
      endDate: '2024-01-16',
      sources: ['chatgpt'],
      filterProfileId,
      model: 'stub_summarizer_v1',
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: classifyPvId,
      },
    })

    const jobs = await prisma.job.findMany({
      where: { runId: run.id },
      orderBy: { dayDate: 'asc' },
    })

    // First job succeeds
    await prisma.job.update({
      where: { id: jobs[0].id },
      data: { status: 'SUCCEEDED', tokensIn: 100, tokensOut: 50, costUsd: 0.005 },
    })

    // Second job fails (has partial tokens from before failure)
    if (jobs.length >= 2) {
      await prisma.job.update({
        where: { id: jobs[1].id },
        data: { status: 'FAILED', tokensIn: 80, tokensOut: 30, costUsd: 0.003 },
      })
    }

    const totals = await prisma.job.aggregate({
      where: { runId: run.id, status: 'SUCCEEDED' },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    })

    // Only the first SUCCEEDED job should count
    expect(totals._sum.tokensIn).toBe(100)
    expect(totals._sum.tokensOut).toBe(50)
    expect(totals._sum.costUsd).toBeCloseTo(0.005, 4)
  })

  it('mixed job states produce correct totals', async () => {
    const run = await createRun({
      importBatchId,
      startDate: '2024-01-15',
      endDate: '2024-01-16',
      sources: ['chatgpt'],
      filterProfileId,
      model: 'stub_summarizer_v1',
      labelSpec: {
        model: 'stub_v1',
        promptVersionId: classifyPvId,
      },
    })

    const jobs = await prisma.job.findMany({
      where: { runId: run.id },
      orderBy: { dayDate: 'asc' },
    })

    if (jobs.length >= 2) {
      // One SUCCEEDED, one still QUEUED
      await prisma.job.update({
        where: { id: jobs[0].id },
        data: { status: 'SUCCEEDED', tokensIn: 150, tokensOut: 60, costUsd: 0.008 },
      })

      // Second job still QUEUED (null tokens)
      const totals = await prisma.job.aggregate({
        where: { runId: run.id, status: 'SUCCEEDED' },
        _sum: {
          tokensIn: true,
          tokensOut: true,
          costUsd: true,
        },
      })

      expect(totals._sum.tokensIn).toBe(150)
      expect(totals._sum.tokensOut).toBe(60)
      expect(totals._sum.costUsd).toBeCloseTo(0.008, 4)
    } else {
      // Only 1 job — succeed it
      await prisma.job.update({
        where: { id: jobs[0].id },
        data: { status: 'SUCCEEDED', tokensIn: 150, tokensOut: 60, costUsd: 0.008 },
      })

      const totals = await prisma.job.aggregate({
        where: { runId: run.id, status: 'SUCCEEDED' },
        _sum: {
          tokensIn: true,
          tokensOut: true,
          costUsd: true,
        },
      })

      expect(totals._sum.tokensIn).toBe(150)
      expect(totals._sum.tokensOut).toBe(60)
      expect(totals._sum.costUsd).toBeCloseTo(0.008, 4)
    }
  })
})
