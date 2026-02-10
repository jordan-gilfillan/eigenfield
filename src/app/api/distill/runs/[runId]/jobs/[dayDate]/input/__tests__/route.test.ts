/**
 * Route-level tests for GET /api/distill/runs/:runId/jobs/:dayDate/input
 *
 * AUD-045: Verifies multi-batch correctness — the input endpoint must resolve
 * importBatchIds from the RunBatch junction (not deprecated run.importBatchId)
 * and produce hashes/preview consistent with the bundle used by tick.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/db'
import { buildBundle } from '@/lib/services/bundle'

const TEST_PREFIX = 'aud045'

// Track IDs for cleanup
let batch1Id: string
let batch2Id: string
let filterProfileId: string
let classifyPromptId: string
let classifyPvId: string
let summarizePromptId: string
let summarizePvId: string
let multiBatchRunId: string
let singleBatchRunId: string

beforeAll(async () => {
  // Batch 1: CHATGPT
  const b1 = await prisma.importBatch.create({
    data: {
      id: `${TEST_PREFIX}-batch1`,
      source: 'CHATGPT',
      originalFilename: 'chatgpt.json',
      fileSizeBytes: 100,
      timezone: 'America/New_York',
      statsJson: { message_count: 3, day_count: 1, coverage_start: '2024-03-01', coverage_end: '2024-03-01' },
    },
  })
  batch1Id = b1.id

  // Batch 2: CLAUDE (same TZ)
  const b2 = await prisma.importBatch.create({
    data: {
      id: `${TEST_PREFIX}-batch2`,
      source: 'CLAUDE',
      originalFilename: 'claude.json',
      fileSizeBytes: 100,
      timezone: 'America/New_York',
      statsJson: { message_count: 3, day_count: 1, coverage_start: '2024-03-01', coverage_end: '2024-03-01' },
    },
  })
  batch2Id = b2.id

  // Prompts
  const cp = await prisma.prompt.create({
    data: { id: `${TEST_PREFIX}-cp`, stage: 'CLASSIFY', name: `${TEST_PREFIX}-classify` },
  })
  classifyPromptId = cp.id
  const cpv = await prisma.promptVersion.create({
    data: { id: `${TEST_PREFIX}-cpv`, promptId: cp.id, versionLabel: 'v1', templateText: 'classify', isActive: true },
  })
  classifyPvId = cpv.id

  const sp = await prisma.prompt.create({
    data: { id: `${TEST_PREFIX}-sp`, stage: 'SUMMARIZE', name: `${TEST_PREFIX}-summarize` },
  })
  summarizePromptId = sp.id
  const spv = await prisma.promptVersion.create({
    data: { id: `${TEST_PREFIX}-spv`, promptId: sp.id, versionLabel: 'v1', templateText: 'summarize', isActive: true },
  })
  summarizePvId = spv.id

  // Filter profile (INCLUDE WORK)
  await prisma.filterProfile.create({
    data: { id: `${TEST_PREFIX}-fp`, name: `${TEST_PREFIX}-fp`, mode: 'INCLUDE', categories: ['WORK'] },
  })
  filterProfileId = `${TEST_PREFIX}-fp`

  // RawEntries for both batches
  await prisma.rawEntry.create({
    data: {
      id: `${TEST_PREFIX}-re1`,
      importBatchId: batch1Id,
      source: 'CHATGPT',
      dayDate: new Date('2024-03-01'),
      contentText: 'chatgpt raw',
      contentHash: `${TEST_PREFIX}-rh1`,
    },
  })
  await prisma.rawEntry.create({
    data: {
      id: `${TEST_PREFIX}-re2`,
      importBatchId: batch2Id,
      source: 'CLAUDE',
      dayDate: new Date('2024-03-01'),
      contentText: 'claude raw',
      contentHash: `${TEST_PREFIX}-rh2`,
    },
  })

  // Atoms: 2 per batch on 2024-03-01
  const atomData = [
    {
      id: `${TEST_PREFIX}-a1`,
      atomStableId: `${TEST_PREFIX}-stable-a1`,
      importBatchId: batch1Id,
      source: 'CHATGPT' as const,
      role: 'USER' as const,
      text: 'ChatGPT user message',
      textHash: `${TEST_PREFIX}-th1`,
      timestampUtc: new Date('2024-03-01T10:00:00Z'),
      dayDate: new Date('2024-03-01'),
    },
    {
      id: `${TEST_PREFIX}-a2`,
      atomStableId: `${TEST_PREFIX}-stable-a2`,
      importBatchId: batch1Id,
      source: 'CHATGPT' as const,
      role: 'ASSISTANT' as const,
      text: 'ChatGPT assistant reply',
      textHash: `${TEST_PREFIX}-th2`,
      timestampUtc: new Date('2024-03-01T10:01:00Z'),
      dayDate: new Date('2024-03-01'),
    },
    {
      id: `${TEST_PREFIX}-a3`,
      atomStableId: `${TEST_PREFIX}-stable-a3`,
      importBatchId: batch2Id,
      source: 'CLAUDE' as const,
      role: 'USER' as const,
      text: 'Claude user message',
      textHash: `${TEST_PREFIX}-th3`,
      timestampUtc: new Date('2024-03-01T11:00:00Z'),
      dayDate: new Date('2024-03-01'),
    },
    {
      id: `${TEST_PREFIX}-a4`,
      atomStableId: `${TEST_PREFIX}-stable-a4`,
      importBatchId: batch2Id,
      source: 'CLAUDE' as const,
      role: 'ASSISTANT' as const,
      text: 'Claude assistant reply',
      textHash: `${TEST_PREFIX}-th4`,
      timestampUtc: new Date('2024-03-01T11:01:00Z'),
      dayDate: new Date('2024-03-01'),
    },
  ]

  for (const atom of atomData) {
    await prisma.messageAtom.create({ data: atom })
    await prisma.messageLabel.create({
      data: {
        id: `${TEST_PREFIX}-lbl-${atom.id.slice(-2)}`,
        messageAtomId: atom.id,
        model: 'stub_v1',
        promptVersionId: classifyPvId,
        category: 'WORK',
        confidence: 1.0,
      },
    })
  }

  const configJson = {
    promptVersionIds: { summarize: summarizePvId },
    labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
    filterProfileSnapshot: { name: `${TEST_PREFIX}-fp`, mode: 'include', categories: ['WORK'] },
    timezone: 'America/New_York',
    maxInputTokens: 12000,
    importBatchIds: [batch1Id, batch2Id],
  }

  // Multi-batch run: importBatchId = batch1 (deprecated), RunBatch = [batch1, batch2]
  const mbRun = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run-mb`,
      status: 'QUEUED',
      importBatchId: batch1Id, // deprecated field — only batch1
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-03-01'),
      sources: ['CHATGPT', 'CLAUDE'],
      filterProfileId,
      model: 'stub_v1',
      outputTarget: 'db',
      configJson,
      runBatches: {
        create: [
          { importBatchId: batch1Id },
          { importBatchId: batch2Id },
        ],
      },
    },
  })
  multiBatchRunId = mbRun.id

  await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job-mb`,
      runId: multiBatchRunId,
      dayDate: new Date('2024-03-01'),
      status: 'QUEUED',
      attempt: 1,
    },
  })

  // Single-batch run: importBatchId = batch1, RunBatch = [batch1]
  const sbRun = await prisma.run.create({
    data: {
      id: `${TEST_PREFIX}-run-sb`,
      status: 'QUEUED',
      importBatchId: batch1Id,
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-03-01'),
      sources: ['CHATGPT'],
      filterProfileId,
      model: 'stub_v1',
      outputTarget: 'db',
      configJson: {
        ...configJson,
        importBatchIds: [batch1Id],
      },
      runBatches: {
        create: [{ importBatchId: batch1Id }],
      },
    },
  })
  singleBatchRunId = sbRun.id

  await prisma.job.create({
    data: {
      id: `${TEST_PREFIX}-job-sb`,
      runId: singleBatchRunId,
      dayDate: new Date('2024-03-01'),
      status: 'QUEUED',
      attempt: 1,
    },
  })
})

afterAll(async () => {
  await prisma.output.deleteMany({ where: { job: { runId: { in: [multiBatchRunId, singleBatchRunId] } } } })
  await prisma.job.deleteMany({ where: { runId: { in: [multiBatchRunId, singleBatchRunId] } } })
  await prisma.runBatch.deleteMany({ where: { runId: { in: [multiBatchRunId, singleBatchRunId] } } })
  await prisma.run.deleteMany({ where: { id: { in: [multiBatchRunId, singleBatchRunId] } } })
  await prisma.messageLabel.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}-lbl` } } })
  await prisma.messageAtom.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}-a` } } })
  await prisma.rawEntry.deleteMany({ where: { id: { startsWith: `${TEST_PREFIX}-re` } } })
  await prisma.importBatch.deleteMany({ where: { id: { in: [batch1Id, batch2Id] } } })
  await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
  await prisma.promptVersion.deleteMany({ where: { id: { in: [classifyPvId, summarizePvId] } } })
  await prisma.prompt.deleteMany({ where: { id: { in: [classifyPromptId, summarizePromptId] } } })
})

/** Helper: call the GET route handler */
function callInput(runId: string, dayDate: string) {
  const req = new NextRequest(
    `http://localhost:3000/api/distill/runs/${runId}/jobs/${dayDate}/input`
  )
  return GET(req, { params: Promise.resolve({ runId, dayDate }) })
}

describe('GET /api/distill/runs/:runId/jobs/:dayDate/input — multi-batch', () => {
  it('multi-batch run includes atoms from both batches', async () => {
    const res = await callInput(multiBatchRunId, '2024-03-01')
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.hasInput).toBe(true)
    // 2 user atoms total: 1 from batch1 (chatgpt) + 1 from batch2 (claude) — assistant excluded per §9.1
    expect(json.atomCount).toBe(2)

    const sources = json.previewItems.map((p: { source: string }) => p.source)
    expect(sources).toContain('chatgpt')
    expect(sources).toContain('claude')
  })

  it('multi-batch input hashes match buildBundle with importBatchIds', async () => {
    const res = await callInput(multiBatchRunId, '2024-03-01')
    const json = await res.json()

    // Read the run's frozen config from DB (same round-trip the route performs)
    const run = await prisma.run.findUnique({
      where: { id: multiBatchRunId },
      select: { sources: true, configJson: true, runBatches: { select: { importBatchId: true } } },
    })
    const config = run!.configJson as { labelSpec: { model: string; promptVersionId: string }; filterProfileSnapshot: { name: string; mode: string; categories: string[] } }
    const sources = (run!.sources as string[]).map((s) => s.toLowerCase())
    const importBatchIds = run!.runBatches.map((rb) => rb.importBatchId)

    // Build the same bundle using the DB-round-tripped config (what tick uses)
    const expected = await buildBundle({
      importBatchIds,
      dayDate: '2024-03-01',
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    expect(json.bundleHash).toBe(expected.bundleHash)
    expect(json.bundleContextHash).toBe(expected.bundleContextHash)
    expect(json.atomCount).toBe(expected.atomCount)
  })

  it('multi-batch input differs from single-batch build (regression)', async () => {
    const res = await callInput(multiBatchRunId, '2024-03-01')
    const json = await res.json()

    // Build using only the deprecated importBatchId (batch1 only) — the OLD behavior
    const oldBundle = await buildBundle({
      importBatchId: batch1Id,
      dayDate: '2024-03-01',
      sources: ['chatgpt', 'claude'],
      labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      filterProfile: { name: `${TEST_PREFIX}-fp`, mode: 'include', categories: ['WORK'] },
    })

    // Old behavior only sees batch1 (chatgpt user), so fewer atoms
    expect(oldBundle.atomCount).toBe(1)
    // Endpoint now returns 2 user atoms (both batches)
    expect(json.atomCount).toBe(2)
    // Hashes must differ
    expect(json.bundleHash).not.toBe(oldBundle.bundleHash)
  })

  it('single-batch run behavior unchanged', async () => {
    const res = await callInput(singleBatchRunId, '2024-03-01')
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.hasInput).toBe(true)
    // Only batch1 (chatgpt) user atom — assistant excluded per §9.1
    expect(json.atomCount).toBe(1)

    // Read the run's frozen config from DB (same round-trip the route performs)
    const run = await prisma.run.findUnique({
      where: { id: singleBatchRunId },
      select: { sources: true, configJson: true, runBatches: { select: { importBatchId: true } } },
    })
    const config = run!.configJson as { labelSpec: { model: string; promptVersionId: string }; filterProfileSnapshot: { name: string; mode: string; categories: string[] } }
    const sources = (run!.sources as string[]).map((s) => s.toLowerCase())
    const importBatchIds = run!.runBatches.map((rb) => rb.importBatchId)

    // Hashes match single-batch buildBundle with DB-round-tripped config
    const expected = await buildBundle({
      importBatchIds,
      dayDate: '2024-03-01',
      sources,
      labelSpec: config.labelSpec,
      filterProfile: config.filterProfileSnapshot,
    })

    expect(json.bundleHash).toBe(expected.bundleHash)
    expect(json.bundleContextHash).toBe(expected.bundleContextHash)
  })

  it('returns 404 for nonexistent run', async () => {
    const res = await callInput('nonexistent-run-id', '2024-03-01')
    expect(res.status).toBe(404)
  })

  it('returns 404 for dayDate not in run', async () => {
    const res = await callInput(multiBatchRunId, '2099-12-31')
    expect(res.status).toBe(404)
  })
})
