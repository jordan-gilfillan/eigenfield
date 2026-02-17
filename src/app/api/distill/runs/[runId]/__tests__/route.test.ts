import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/db'

function callRunDetail(runId: string) {
  const req = new NextRequest(`http://localhost:3000/api/distill/runs/${runId}`)
  return GET(req, { params: Promise.resolve({ runId }) })
}

describe('GET /api/distill/runs/:runId — deterministic runBatches ordering (AUD-096)', () => {
  const createdBatchIds: string[] = []
  const createdRunIds: string[] = []
  const createdFilterProfileIds: string[] = []
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `rt-run-detail-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(async () => {
    await prisma.output.deleteMany({ where: { job: { runId: { in: createdRunIds } } } })
    await prisma.job.deleteMany({ where: { runId: { in: createdRunIds } } })
    await prisma.runBatch.deleteMany({ where: { runId: { in: createdRunIds } } })
    await prisma.run.deleteMany({ where: { id: { in: createdRunIds } } })
    await prisma.filterProfile.deleteMany({ where: { id: { in: createdFilterProfileIds } } })
    await prisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } })
    createdRunIds.length = 0
    createdBatchIds.length = 0
    createdFilterProfileIds.length = 0
  })

  it('uses canonical order by runBatch.createdAt asc; first-batch fields are stable', async () => {
    const earlyBatchId = `aud096-rd-early-${uniqueId}`
    const lateBatchId = `aud096-rd-late-${uniqueId}`
    createdBatchIds.push(earlyBatchId, lateBatchId)

    await prisma.importBatch.create({
      data: {
        id: earlyBatchId,
        source: 'CHATGPT',
        originalFilename: 'early.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 1,
          day_count: 1,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-01',
        },
      },
    })

    await prisma.importBatch.create({
      data: {
        id: lateBatchId,
        source: 'CLAUDE',
        originalFilename: 'late.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 1,
          day_count: 1,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-01',
        },
      },
    })

    const filterProfileId = `aud096-rd-fp-${uniqueId}`
    createdFilterProfileIds.push(filterProfileId)
    await prisma.filterProfile.create({
      data: {
        id: filterProfileId,
        name: `AUD096 Run Detail ${uniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })

    const runId = `aud096-rd-run-${uniqueId}`
    createdRunIds.push(runId)
    await prisma.run.create({
      data: {
        id: runId,
        status: 'QUEUED',
        importBatchId: lateBatchId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01'),
        sources: ['CHATGPT', 'CLAUDE'],
        filterProfileId,
        model: 'stub_v1',
        outputTarget: 'db',
        configJson: {
          promptVersionIds: { summarize: 'aud096-sum-pv' },
          labelSpec: { model: 'stub_v1', promptVersionId: 'aud096-cls-pv' },
          filterProfileSnapshot: { name: 'aud096', mode: 'exclude', categories: ['WORK'] },
          timezone: 'America/New_York',
          maxInputTokens: 12000,
          importBatchIds: [earlyBatchId, lateBatchId],
        },
        runBatches: {
          create: [
            {
              id: `aud096-rd-rb-late-${uniqueId}`,
              importBatchId: lateBatchId,
              createdAt: new Date('2024-01-01T11:00:00.000Z'),
            },
            {
              id: `aud096-rd-rb-early-${uniqueId}`,
              importBatchId: earlyBatchId,
              createdAt: new Date('2024-01-01T10:00:00.000Z'),
            },
          ],
        },
      },
    })

    const res1 = await callRunDetail(runId)
    expect(res1.status).toBe(200)
    const json1 = await res1.json()

    const res2 = await callRunDetail(runId)
    expect(res2.status).toBe(200)
    const json2 = await res2.json()

    const expected = [earlyBatchId, lateBatchId]
    expect(json1.importBatchIds).toEqual(expected)
    expect(json2.importBatchIds).toEqual(expected)
    expect(json1.importBatchId).toBe(earlyBatchId)
    expect(json2.importBatchId).toBe(earlyBatchId)
    expect(json1.importBatches.map((b: { id: string }) => b.id)).toEqual(expected)
    expect(json2.importBatches.map((b: { id: string }) => b.id)).toEqual(expected)
  })

  it('uses runBatch.id asc as deterministic tie-breaker when createdAt is equal', async () => {
    const batchAId = `aud096-rd-a-${uniqueId}`
    const batchBId = `aud096-rd-b-${uniqueId}`
    createdBatchIds.push(batchAId, batchBId)

    await prisma.importBatch.create({
      data: {
        id: batchAId,
        source: 'CHATGPT',
        originalFilename: 'a.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 1,
          day_count: 1,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-01',
        },
      },
    })

    await prisma.importBatch.create({
      data: {
        id: batchBId,
        source: 'CLAUDE',
        originalFilename: 'b.json',
        fileSizeBytes: 100,
        timezone: 'America/New_York',
        statsJson: {
          message_count: 1,
          day_count: 1,
          coverage_start: '2024-01-01',
          coverage_end: '2024-01-01',
        },
      },
    })

    const filterProfileId = `aud096-rd-fp2-${uniqueId}`
    createdFilterProfileIds.push(filterProfileId)
    await prisma.filterProfile.create({
      data: {
        id: filterProfileId,
        name: `AUD096 Run Detail Tie ${uniqueId}`,
        mode: 'EXCLUDE',
        categories: ['WORK'],
      },
    })

    const runId = `aud096-rd-run2-${uniqueId}`
    createdRunIds.push(runId)
    const sameCreatedAt = new Date('2024-01-02T10:00:00.000Z')
    await prisma.run.create({
      data: {
        id: runId,
        status: 'QUEUED',
        importBatchId: batchBId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-01'),
        sources: ['CHATGPT', 'CLAUDE'],
        filterProfileId,
        model: 'stub_v1',
        outputTarget: 'db',
        configJson: {
          promptVersionIds: { summarize: 'aud096-sum-pv' },
          labelSpec: { model: 'stub_v1', promptVersionId: 'aud096-cls-pv' },
          filterProfileSnapshot: { name: 'aud096', mode: 'exclude', categories: ['WORK'] },
          timezone: 'America/New_York',
          maxInputTokens: 12000,
          importBatchIds: [batchAId, batchBId],
        },
        runBatches: {
          create: [
            {
              id: `aud096-rd-rb-b-${uniqueId}`,
              importBatchId: batchBId,
              createdAt: sameCreatedAt,
            },
            {
              id: `aud096-rd-rb-a-${uniqueId}`,
              importBatchId: batchAId,
              createdAt: sameCreatedAt,
            },
          ],
        },
      },
    })

    const res = await callRunDetail(runId)
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.importBatchIds).toEqual([batchAId, batchBId])
    expect(json.importBatchId).toBe(batchAId)
    expect(json.importBatches.map((b: { id: string }) => b.id)).toEqual([batchAId, batchBId])
  })
})

