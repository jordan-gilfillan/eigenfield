import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/db'

function callRoute(params?: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/distill/import-batches')
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }
  return GET(new NextRequest(url))
}

describe('GET /api/distill/import-batches', () => {
  const createdBatchIds: string[] = []
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `rt-import-batches-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(async () => {
    await prisma.rawEntry.deleteMany({ where: { importBatchId: { in: createdBatchIds } } })
    await prisma.messageAtom.deleteMany({ where: { importBatchId: { in: createdBatchIds } } })
    await prisma.importBatch.deleteMany({ where: { id: { in: createdBatchIds } } })
    createdBatchIds.length = 0
  })

  it('returns storedCounts derived from persisted atoms and raw entries', async () => {
    const populatedBatchId = `rt-import-batches-populated-${uniqueId}`
    const emptyBatchId = `rt-import-batches-empty-${uniqueId}`
    createdBatchIds.push(populatedBatchId, emptyBatchId)

    await prisma.importBatch.create({
      data: {
        id: populatedBatchId,
        source: 'CHATGPT',
        originalFilename: 'populated.json',
        fileSizeBytes: 100,
        timezone: 'UTC',
        statsJson: {
          message_count: 3,
          day_count: 1,
          coverage_start: '2026-03-01',
          coverage_end: '2026-03-01',
          per_source_counts: { chatgpt: 3 },
        },
      },
    })

    await prisma.importBatch.create({
      data: {
        id: emptyBatchId,
        source: 'CHATGPT',
        originalFilename: 'duplicate.json',
        fileSizeBytes: 100,
        timezone: 'UTC',
        statsJson: {
          message_count: 3,
          day_count: 1,
          coverage_start: '2026-03-01',
          coverage_end: '2026-03-01',
          per_source_counts: { chatgpt: 3 },
        },
      },
    })

    await prisma.messageAtom.createMany({
      data: [
        {
          id: `rt-atom-1-${uniqueId}`,
          atomStableId: `rt-stable-1-${uniqueId}`,
          importBatchId: populatedBatchId,
          source: 'CHATGPT',
          timestampUtc: new Date('2026-03-01T10:00:00.000Z'),
          dayDate: new Date('2026-03-01'),
          role: 'USER',
          text: 'hello',
          textHash: `rt-text-hash-1-${uniqueId}`,
        },
        {
          id: `rt-atom-2-${uniqueId}`,
          atomStableId: `rt-stable-2-${uniqueId}`,
          importBatchId: populatedBatchId,
          source: 'CHATGPT',
          timestampUtc: new Date('2026-03-01T10:01:00.000Z'),
          dayDate: new Date('2026-03-01'),
          role: 'ASSISTANT',
          text: 'world',
          textHash: `rt-text-hash-2-${uniqueId}`,
        },
      ],
    })

    await prisma.rawEntry.create({
      data: {
        id: `rt-raw-1-${uniqueId}`,
        importBatchId: populatedBatchId,
        source: 'CHATGPT',
        dayDate: new Date('2026-03-01'),
        contentText: 'USER: hello\nASSISTANT: world',
        contentHash: `rt-raw-hash-1-${uniqueId}`,
      },
    })

    const res = await callRoute({ limit: '50' })
    expect(res.status).toBe(200)
    const json = await res.json()

    const populated = json.items.find((item: { id: string }) => item.id === populatedBatchId)
    const empty = json.items.find((item: { id: string }) => item.id === emptyBatchId)

    expect(populated?.storedCounts).toEqual({
      messageAtoms: 2,
      rawEntries: 1,
    })
    expect(empty?.storedCounts).toEqual({
      messageAtoms: 0,
      rawEntries: 0,
    })
  })
})
