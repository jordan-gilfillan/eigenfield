import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/db'

function callRoute(id: string) {
  const req = new NextRequest(`http://localhost:3000/api/distill/import-batches/${id}`)
  return GET(req, { params: Promise.resolve({ id }) })
}

describe('GET /api/distill/import-batches/:id', () => {
  const createdBatchIds: string[] = []
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `rt-import-batch-detail-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(async () => {
    await prisma.rawEntry.deleteMany({ where: { importBatchId: { in: createdBatchIds } } })
    await prisma.messageAtom.deleteMany({ where: { importBatchId: { in: createdBatchIds } } })
    await prisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } })
    createdBatchIds.length = 0
  })

  it('returns storedCounts derived from persisted batch contents', async () => {
    const batchId = `rt-import-batch-detail-batch-${uniqueId}`
    createdBatchIds.push(batchId)

    await prisma.importBatch.create({
      data: {
        id: batchId,
        source: 'CLAUDE',
        originalFilename: 'existing.json',
        fileSizeBytes: 100,
        timezone: 'UTC',
        statsJson: {
          message_count: 2,
          day_count: 1,
          coverage_start: '2026-03-02',
          coverage_end: '2026-03-02',
          per_source_counts: { claude: 2 },
        },
      },
    })

    await prisma.messageAtom.create({
      data: {
        id: `rt-detail-atom-${uniqueId}`,
        atomStableId: `rt-detail-stable-${uniqueId}`,
        importBatchId: batchId,
        source: 'CLAUDE',
        timestampUtc: new Date('2026-03-02T12:00:00.000Z'),
        dayDate: new Date('2026-03-02'),
        role: 'USER',
        text: 'reuse me',
        textHash: `rt-detail-text-hash-${uniqueId}`,
      },
    })

    await prisma.rawEntry.create({
      data: {
        id: `rt-detail-raw-${uniqueId}`,
        importBatchId: batchId,
        source: 'CLAUDE',
        dayDate: new Date('2026-03-02'),
        contentText: 'USER: reuse me',
        contentHash: `rt-detail-raw-hash-${uniqueId}`,
      },
    })

    const res = await callRoute(batchId)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.importBatch.storedCounts).toEqual({
      messageAtoms: 1,
      rawEntries: 1,
    })
  })
})
