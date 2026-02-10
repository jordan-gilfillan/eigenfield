/**
 * Route-level tests for POST/GET /api/distill/runs
 *
 * Tests the API contract for multi-batch support (AUD-043d):
 * - importBatchId XOR importBatchIds validation
 * - TimezoneMismatchError mapping
 * - GET response includes importBatchIds[]
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST, GET } from '../route'
import { prisma } from '@/lib/db'

/** Helper: build a POST NextRequest with JSON body */
function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/distill/runs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Helper: build a GET NextRequest with optional query params */
function getRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/distill/runs')
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return new NextRequest(url)
}

describe('POST /api/distill/runs — importBatchId XOR importBatchIds validation', () => {
  it('rejects when both importBatchId and importBatchIds provided', async () => {
    const res = await POST(
      postRequest({
        importBatchId: 'batch-a',
        importBatchIds: ['batch-a', 'batch-b'],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: 'fp-1',
        model: 'stub_v1',
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('not both')
  })

  it('rejects when neither importBatchId nor importBatchIds provided', async () => {
    const res = await POST(
      postRequest({
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: 'fp-1',
        model: 'stub_v1',
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('importBatchId or importBatchIds is required')
  })

  it('rejects empty importBatchIds array', async () => {
    const res = await POST(
      postRequest({
        importBatchIds: [],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: 'fp-1',
        model: 'stub_v1',
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('non-empty')
  })

  it('rejects duplicate importBatchIds', async () => {
    const res = await POST(
      postRequest({
        importBatchIds: ['batch-a', 'batch-a'],
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        sources: ['chatgpt'],
        filterProfileId: 'fp-1',
        model: 'stub_v1',
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('unique')
  })
})

describe('POST /api/distill/runs — multi-batch integration', () => {
  let batch1Id: string
  let batch2Id: string
  let batch3Id: string // different TZ
  let filterProfileId: string
  let classifyPromptId: string
  let classifyPvId: string
  let summarizePromptId: string
  let summarizePvId: string
  let uniqueId: string

  beforeEach(async () => {
    uniqueId = `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Batch 1: CHATGPT, America/New_York
    const b1 = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'chatgpt.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: { message_count: 3, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batch1Id = b1.id

    // Batch 2: CLAUDE, America/New_York (same TZ)
    const b2 = await prisma.importBatch.create({
      data: {
        source: 'CLAUDE',
        originalFilename: 'claude.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: { message_count: 3, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batch2Id = b2.id

    // Batch 3: GROK, Europe/London (different TZ)
    const b3 = await prisma.importBatch.create({
      data: {
        source: 'GROK',
        originalFilename: 'grok.json',
        fileSizeBytes: 100,
        timezone: 'Europe/London',
        statsJson: { message_count: 3, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batch3Id = b3.id

    // Filter profile
    const fp = await prisma.filterProfile.create({
      data: { name: `Route Test FP ${uniqueId}`, mode: 'EXCLUDE', categories: ['WORK'] },
    })
    filterProfileId = fp.id

    // Prompts + versions
    const cp = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Route Test Classify ${uniqueId}` },
    })
    classifyPromptId = cp.id
    const cpv = await prisma.promptVersion.create({
      data: { promptId: cp.id, versionLabel: 'rt-v1', templateText: 'classify', isActive: true },
    })
    classifyPvId = cpv.id

    const sp = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Route Test Summarize ${uniqueId}` },
    })
    summarizePromptId = sp.id
    const spv = await prisma.promptVersion.create({
      data: { promptId: sp.id, versionLabel: 'rt-v1', templateText: 'summarize', isActive: true },
    })
    summarizePvId = spv.id

    // Atoms + labels for batch1 and batch2 on day 2024-01-01
    for (const [batchId, source] of [
      [batch1Id, 'CHATGPT'],
      [batch2Id, 'CLAUDE'],
    ] as const) {
      await prisma.rawEntry.create({
        data: {
          importBatchId: batchId,
          source,
          dayDate: new Date('2024-01-01'),
          contentText: `${source} content`,
          contentHash: `${source}-hash-${uniqueId}`,
        },
      })

      for (let j = 0; j < 2; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: batchId,
            source,
            role: j === 0 ? 'USER' : 'ASSISTANT',
            text: `${source} msg ${j}`,
            textHash: `${source}-text-${uniqueId}-${j}`,
            timestampUtc: new Date(Date.UTC(2024, 0, 1, 12, 0, j)),
            dayDate: new Date('2024-01-01'),
            atomStableId: `rt-${source.toLowerCase()}-${uniqueId}-${j}`,
          },
        })

        await prisma.messageLabel.create({
          data: {
            messageAtomId: atom.id,
            model: 'stub_v1',
            promptVersionId: classifyPvId,
            category: 'PERSONAL',
            confidence: 1.0,
          },
        })
      }
    }
  })

  afterEach(async () => {
    for (const batchId of [batch1Id, batch2Id, batch3Id]) {
      await prisma.output.deleteMany({ where: { job: { run: { importBatchId: batchId } } } })
      await prisma.job.deleteMany({ where: { run: { importBatchId: batchId } } })
      await prisma.runBatch.deleteMany({ where: { run: { importBatchId: batchId } } })
      await prisma.run.deleteMany({ where: { importBatchId: batchId } })
      await prisma.messageLabel.deleteMany({ where: { messageAtom: { importBatchId: batchId } } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: batchId } })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: batchId } })
    }
    await prisma.importBatch.deleteMany({ where: { id: { in: [batch1Id, batch2Id, batch3Id] } } })
    await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
    await prisma.promptVersion.deleteMany({ where: { id: { in: [classifyPvId, summarizePvId] } } })
    await prisma.prompt.deleteMany({ where: { id: { in: [classifyPromptId, summarizePromptId] } } })
  })

  it('POST with importBatchIds: [a, b] → run with 2 batches', async () => {
    const res = await POST(
      postRequest({
        importBatchIds: [batch1Id, batch2Id],
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        sources: ['chatgpt', 'claude'],
        filterProfileId,
        model: 'stub_v1',
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.importBatchIds).toEqual(expect.arrayContaining([batch1Id, batch2Id]))
    expect(json.importBatchIds).toHaveLength(2)

    // Verify RunBatch rows
    const runBatches = await prisma.runBatch.findMany({ where: { runId: json.id } })
    expect(runBatches).toHaveLength(2)
  })

  it('POST with importBatchId: a → run with 1 batch (backward compat)', async () => {
    const res = await POST(
      postRequest({
        importBatchId: batch1Id,
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        sources: ['chatgpt'],
        filterProfileId,
        model: 'stub_v1',
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      })
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.importBatchId).toBe(batch1Id)
    expect(json.importBatchIds).toEqual([batch1Id])
  })

  it('POST with mixed timezones → 400 TIMEZONE_MISMATCH', async () => {
    const res = await POST(
      postRequest({
        importBatchIds: [batch1Id, batch3Id],
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        sources: ['chatgpt', 'grok'],
        filterProfileId,
        model: 'stub_v1',
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      })
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('TIMEZONE_MISMATCH')
    expect(json.error.details.timezones).toEqual(
      expect.arrayContaining(['America/New_York', 'Europe/London'])
    )
  })
})

describe('GET /api/distill/runs — RunBatch membership filter (AUD-046)', () => {
  let batch1Id: string
  let batch2Id: string
  let filterProfileId: string
  let classifyPromptId: string
  let classifyPvId: string
  let summarizePromptId: string
  let summarizePvId: string
  let uniqueId: string
  let multiBatchRunId: string

  beforeEach(async () => {
    uniqueId = `rt-046-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Batch 1: CHATGPT
    const b1 = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'chatgpt.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: { message_count: 2, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batch1Id = b1.id

    // Batch 2: CLAUDE (same TZ)
    const b2 = await prisma.importBatch.create({
      data: {
        source: 'CLAUDE',
        originalFilename: 'claude.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: { message_count: 2, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batch2Id = b2.id

    // Filter profile
    const fp = await prisma.filterProfile.create({
      data: { name: `AUD046 FP ${uniqueId}`, mode: 'EXCLUDE', categories: ['WORK'] },
    })
    filterProfileId = fp.id

    // Prompts + versions
    const cp = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `AUD046 Classify ${uniqueId}` },
    })
    classifyPromptId = cp.id
    const cpv = await prisma.promptVersion.create({
      data: { promptId: cp.id, versionLabel: 'v1', templateText: 'classify', isActive: true },
    })
    classifyPvId = cpv.id

    const sp = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `AUD046 Summarize ${uniqueId}` },
    })
    summarizePromptId = sp.id
    await prisma.promptVersion.create({
      data: { promptId: sp.id, versionLabel: 'v1', templateText: 'summarize', isActive: true },
    })
    summarizePvId = (await prisma.promptVersion.findFirst({ where: { promptId: sp.id } }))!.id

    // Atoms + labels for both batches
    for (const [batchId, source] of [
      [batch1Id, 'CHATGPT'],
      [batch2Id, 'CLAUDE'],
    ] as const) {
      await prisma.rawEntry.create({
        data: {
          importBatchId: batchId,
          source,
          dayDate: new Date('2024-01-01'),
          contentText: `${source} content`,
          contentHash: `${source}-hash-${uniqueId}`,
        },
      })

      for (let j = 0; j < 2; j++) {
        const atom = await prisma.messageAtom.create({
          data: {
            importBatchId: batchId,
            source,
            role: j === 0 ? 'USER' : 'ASSISTANT',
            text: `${source} msg ${j}`,
            textHash: `${source}-text-${uniqueId}-${j}`,
            timestampUtc: new Date(Date.UTC(2024, 0, 1, 12, 0, j)),
            dayDate: new Date('2024-01-01'),
            atomStableId: `rt-046-${source.toLowerCase()}-${uniqueId}-${j}`,
          },
        })

        await prisma.messageLabel.create({
          data: {
            messageAtomId: atom.id,
            model: 'stub_v1',
            promptVersionId: classifyPvId,
            category: 'PERSONAL',
            confidence: 1.0,
          },
        })
      }
    }

    // Create a multi-batch run with importBatchIds ordered [batch1, batch2]
    // Deprecated importBatchId will be batch1 (first in the list)
    const createRes = await POST(
      postRequest({
        importBatchIds: [batch1Id, batch2Id],
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        sources: ['chatgpt', 'claude'],
        filterProfileId,
        model: 'stub_v1',
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      })
    )
    expect(createRes.status).toBe(200)
    const createJson = await createRes.json()
    multiBatchRunId = createJson.id
  })

  afterEach(async () => {
    // Clean up in dependency order
    await prisma.output.deleteMany({ where: { job: { runId: multiBatchRunId } } })
    await prisma.job.deleteMany({ where: { runId: multiBatchRunId } })
    await prisma.runBatch.deleteMany({ where: { runId: multiBatchRunId } })
    await prisma.run.deleteMany({ where: { id: multiBatchRunId } })
    for (const batchId of [batch1Id, batch2Id]) {
      await prisma.messageLabel.deleteMany({ where: { messageAtom: { importBatchId: batchId } } })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: batchId } })
      await prisma.rawEntry.deleteMany({ where: { importBatchId: batchId } })
    }
    await prisma.importBatch.deleteMany({ where: { id: { in: [batch1Id, batch2Id] } } })
    await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
    await prisma.promptVersion.deleteMany({ where: { id: { in: [classifyPvId, summarizePvId] } } })
    await prisma.prompt.deleteMany({ where: { id: { in: [classifyPromptId, summarizePromptId] } } })
  })

  it('filtering by non-primary batch returns multi-batch run (AUD-046 regression)', async () => {
    // batch2 is NOT the deprecated importBatchId (that's batch1)
    // Old behavior: would filter on Run.importBatchId = batch2 → no results
    // Fixed behavior: filters on RunBatch membership → run found
    const res = await GET(getRequest({ importBatchId: batch2Id }))
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.items.length).toBeGreaterThanOrEqual(1)
    const found = json.items.find((r: { id: string }) => r.id === multiBatchRunId)
    expect(found).toBeDefined()
    expect(found.importBatchIds).toEqual(expect.arrayContaining([batch1Id, batch2Id]))
  })

  it('filtering by primary batch also returns multi-batch run', async () => {
    // batch1 IS the deprecated importBatchId — should still work
    const res = await GET(getRequest({ importBatchId: batch1Id }))
    expect(res.status).toBe(200)
    const json = await res.json()

    const found = json.items.find((r: { id: string }) => r.id === multiBatchRunId)
    expect(found).toBeDefined()
    expect(found.importBatchIds).toEqual(expect.arrayContaining([batch1Id, batch2Id]))
  })

  it('list without importBatchId filter returns items (unchanged)', async () => {
    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    const json = await res.json()

    // At minimum, our test run should be there
    expect(json.items.length).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /api/distill/runs — importBatchIds in response', () => {
  let batchId: string
  let filterProfileId: string
  let classifyPromptId: string
  let classifyPvId: string
  let summarizePromptId: string
  let summarizePvId: string
  let uniqueId: string

  beforeEach(async () => {
    uniqueId = `rt-get-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const b = await prisma.importBatch.create({
      data: {
        source: 'CHATGPT',
        originalFilename: 'chatgpt.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: { message_count: 2, day_count: 1, coverage_start: '2024-01-01', coverage_end: '2024-01-01' },
      },
    })
    batchId = b.id

    const fp = await prisma.filterProfile.create({
      data: { name: `Route GET FP ${uniqueId}`, mode: 'EXCLUDE', categories: ['WORK'] },
    })
    filterProfileId = fp.id

    const cp = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `Route GET Classify ${uniqueId}` },
    })
    classifyPromptId = cp.id
    const cpv = await prisma.promptVersion.create({
      data: { promptId: cp.id, versionLabel: 'rt-get-v1', templateText: 'classify', isActive: true },
    })
    classifyPvId = cpv.id

    const sp = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `Route GET Summarize ${uniqueId}` },
    })
    summarizePromptId = sp.id
    const spv = await prisma.promptVersion.create({
      data: { promptId: sp.id, versionLabel: 'rt-get-v1', templateText: 'summarize', isActive: true },
    })
    summarizePvId = spv.id

    await prisma.rawEntry.create({
      data: {
        importBatchId: batchId,
        source: 'CHATGPT',
        dayDate: new Date('2024-01-01'),
        contentText: 'content',
        contentHash: `get-hash-${uniqueId}`,
      },
    })

    for (let j = 0; j < 2; j++) {
      const atom = await prisma.messageAtom.create({
        data: {
          importBatchId: batchId,
          source: 'CHATGPT',
          role: j === 0 ? 'USER' : 'ASSISTANT',
          text: `msg ${j}`,
          textHash: `get-text-${uniqueId}-${j}`,
          timestampUtc: new Date(Date.UTC(2024, 0, 1, 12, 0, j)),
          dayDate: new Date('2024-01-01'),
          atomStableId: `rt-get-${uniqueId}-${j}`,
        },
      })

      await prisma.messageLabel.create({
        data: {
          messageAtomId: atom.id,
          model: 'stub_v1',
          promptVersionId: classifyPvId,
          category: 'PERSONAL',
          confidence: 1.0,
        },
      })
    }
  })

  afterEach(async () => {
    await prisma.output.deleteMany({ where: { job: { run: { importBatchId: batchId } } } })
    await prisma.job.deleteMany({ where: { run: { importBatchId: batchId } } })
    await prisma.runBatch.deleteMany({ where: { run: { importBatchId: batchId } } })
    await prisma.run.deleteMany({ where: { importBatchId: batchId } })
    await prisma.messageLabel.deleteMany({ where: { messageAtom: { importBatchId: batchId } } })
    await prisma.messageAtom.deleteMany({ where: { importBatchId: batchId } })
    await prisma.rawEntry.deleteMany({ where: { importBatchId: batchId } })
    await prisma.importBatch.deleteMany({ where: { id: batchId } })
    await prisma.filterProfile.deleteMany({ where: { id: filterProfileId } })
    await prisma.promptVersion.deleteMany({ where: { id: { in: [classifyPvId, summarizePvId] } } })
    await prisma.prompt.deleteMany({ where: { id: { in: [classifyPromptId, summarizePromptId] } } })
  })

  it('GET returns importBatchIds array in each run item', async () => {
    // Create a run first
    const createRes = await POST(
      postRequest({
        importBatchId: batchId,
        startDate: '2024-01-01',
        endDate: '2024-01-01',
        sources: ['chatgpt'],
        filterProfileId,
        model: 'stub_v1',
        labelSpec: { model: 'stub_v1', promptVersionId: classifyPvId },
      })
    )
    expect(createRes.status).toBe(200)

    // List runs filtered by this batch
    const listRes = await GET(getRequest({ importBatchId: batchId }))
    expect(listRes.status).toBe(200)
    const json = await listRes.json()

    expect(json.items.length).toBeGreaterThanOrEqual(1)
    const run = json.items[0]
    expect(run.importBatchId).toBe(batchId)
    expect(run.importBatchIds).toEqual([batchId])
  })
})
