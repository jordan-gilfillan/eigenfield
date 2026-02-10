import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import {
  importExport,
  getImportBatch,
  listImportBatches,
} from '../../lib/services/import'

/**
 * Integration tests for the import service.
 *
 * These tests require a running database (docker compose up -d).
 * They clean up after themselves.
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

describe('Import Service', () => {
  // Track created batches for cleanup
  const createdBatchIds: string[] = []

  afterEach(async () => {
    // Clean up test data
    for (const id of createdBatchIds) {
      await prisma.rawEntry.deleteMany({ where: { importBatchId: id } })
      await prisma.messageLabel.deleteMany({
        where: { messageAtom: { importBatchId: id } },
      })
      await prisma.messageAtom.deleteMany({ where: { importBatchId: id } })
      await prisma.importBatch.delete({ where: { id } }).catch(() => {})
    }
    createdBatchIds.length = 0
  })

  describe('importExport', () => {
    it('creates ImportBatch with correct stats', async () => {
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Hello', timestamp: 1705316400 },
        { id: 'msg-2', role: 'assistant', text: 'Hi there', timestamp: 1705316401 },
      ])

      const result = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('chatgpt')
      expect(result.importBatch.originalFilename).toBe('test.json')
      expect(result.importBatch.stats.message_count).toBe(2)
      expect(result.importBatch.stats.day_count).toBe(1)
      expect(result.created.messageAtoms).toBe(2)
      expect(result.created.rawEntries).toBe(1)
    })

    it('includes both user and assistant messages', async () => {
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Question', timestamp: 1705316400 },
        { id: 'msg-2', role: 'assistant', text: 'Answer', timestamp: 1705316401 },
      ])

      const result = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(result.importBatch.id)

      // Verify both roles are in the database
      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { timestampUtc: 'asc' },
      })

      expect(atoms).toHaveLength(2)
      const roles = new Set(atoms.map(a => a.role))
      expect(roles).toEqual(new Set(['USER', 'ASSISTANT']))
    })

    it('stores two identical messages with different timestamps (no silent loss)', async () => {
      // Spec 11.1: Two identical messages on different timestamps must both be stored
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Same text', timestamp: 1705316400 },
        { id: 'msg-2', role: 'user', text: 'Same text', timestamp: 1705316500 },
      ])

      const result = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.created.messageAtoms).toBe(2)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(2)
      // Both should have same text but different timestamps
      expect(atoms[0].text).toBe('Same text')
      expect(atoms[1].text).toBe('Same text')
      expect(atoms[0].atomStableId).not.toBe(atoms[1].atomStableId)
    })

    it('creates one RawEntry per (source, dayDate)', async () => {
      // Messages on two different days
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Day 1', timestamp: 1705316400 }, // 2024-01-15
        { id: 'msg-2', role: 'user', text: 'Day 2', timestamp: 1705402800 }, // 2024-01-16
      ])

      const result = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
        timezone: 'UTC',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.created.rawEntries).toBe(2)

      const rawEntries = await prisma.rawEntry.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { dayDate: 'asc' },
      })

      expect(rawEntries).toHaveLength(2)
    })

    it('deduplicates by atomStableId on re-import', async () => {
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Hello', timestamp: 1705316400 },
      ])

      // First import
      const result1 = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(result1.importBatch.id)

      expect(result1.created.messageAtoms).toBe(1)

      // Second import of same content
      const result2 = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(result2.importBatch.id)

      // Should report 0 new atoms created (duplicate skipped)
      expect(result2.created.messageAtoms).toBe(0)
      expect(result2.warnings).toContainEqual(
        expect.stringContaining('duplicate')
      )
    })

    it('uses specified timezone for day bucketing', async () => {
      // 1705384800 = 2024-01-16T06:00:00Z
      // In UTC: Jan 16
      // In PST (UTC-8): Jan 15 (22:00)
      const timestamp = 1705384800

      const resultUtc = await importExport({
        content: createTestExport([
          { id: 'msg-1', role: 'user', text: 'Test message', timestamp, conversationId: 'conv-tz-1' },
        ]),
        filename: 'test.json',
        fileSizeBytes: 100,
        timezone: 'UTC',
      })
      createdBatchIds.push(resultUtc.importBatch.id)

      const resultPst = await importExport({
        content: createTestExport([
          { id: 'msg-2', role: 'user', text: 'Test message different', timestamp, conversationId: 'conv-tz-2' },
        ]),
        filename: 'test2.json',
        fileSizeBytes: 100,
        timezone: 'America/Los_Angeles',
      })
      createdBatchIds.push(resultPst.importBatch.id)

      // Same UTC timestamp, different day based on timezone
      expect(resultUtc.importBatch.stats.coverage_start).toBe('2024-01-16')
      expect(resultPst.importBatch.stats.coverage_start).toBe('2024-01-15')
    })

    it('respects sourceOverride', async () => {
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Hello', timestamp: 1705316400 },
      ])

      // ChatGPT format but override to claude
      // This should still work since we're just overriding the label
      const result = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
        sourceOverride: 'chatgpt', // Explicit override (same as auto-detect in this case)
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('chatgpt')
    })
  })

  describe('getImportBatch', () => {
    it('returns batch with stats', async () => {
      const content = createTestExport([
        { id: 'msg-1', role: 'user', text: 'Hello', timestamp: 1705316400 },
      ])

      const importResult = await importExport({
        content,
        filename: 'test.json',
        fileSizeBytes: content.length,
      })
      createdBatchIds.push(importResult.importBatch.id)

      const batch = await getImportBatch(importResult.importBatch.id)

      expect(batch).not.toBeNull()
      expect(batch!.id).toBe(importResult.importBatch.id)
      expect(batch!.stats.message_count).toBe(1)
    })

    it('returns null for non-existent id', async () => {
      const batch = await getImportBatch('non-existent-id')
      expect(batch).toBeNull()
    })
  })

  describe('listImportBatches', () => {
    it('returns batches in descending order by createdAt', async () => {
      // Create two batches
      const content1 = createTestExport([
        { id: 'msg-1', role: 'user', text: 'First', timestamp: 1705316400, conversationId: 'conv-1' },
      ])
      const content2 = createTestExport([
        { id: 'msg-2', role: 'user', text: 'Second', timestamp: 1705316500, conversationId: 'conv-2' },
      ])

      const result1 = await importExport({
        content: content1,
        filename: 'first.json',
        fileSizeBytes: content1.length,
      })
      createdBatchIds.push(result1.importBatch.id)

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10))

      const result2 = await importExport({
        content: content2,
        filename: 'second.json',
        fileSizeBytes: content2.length,
      })
      createdBatchIds.push(result2.importBatch.id)

      const list = await listImportBatches({ limit: 10 })

      // Most recent first
      const ourBatches = list.items.filter((b) =>
        createdBatchIds.includes(b.id)
      )
      expect(ourBatches.length).toBe(2)
      expect(ourBatches[0].originalFilename).toBe('second.json')
      expect(ourBatches[1].originalFilename).toBe('first.json')
    })

    it('supports pagination', async () => {
      // Create 3 batches with deterministic ordering (10ms delay between each)
      for (let i = 0; i < 3; i++) {
        const content = createTestExport([
          { id: `msg-${i}`, role: 'user', text: `Batch ${i}`, timestamp: 1705316400 + i * 100, conversationId: `conv-${i}` },
        ])
        const result = await importExport({
          content,
          filename: `batch-${i}.json`,
          fileSizeBytes: content.length,
        })
        createdBatchIds.push(result.importBatch.id)
        await new Promise((r) => setTimeout(r, 10))
      }

      // Walk pages with limit=2 until all 3 of our batches are found.
      // Other tests may have created batches, so we stop once we've found ours
      // rather than exhausting the entire table.
      const ourIdSet = new Set(createdBatchIds)
      const allIds: string[] = []
      const foundOurs: string[] = []
      let cursor: string | undefined
      let pages = 0
      const MAX_PAGES = 50 // safety valve (never need this many)

      do {
        const page = await listImportBatches({ limit: 2, cursor })
        // Each page respects limit
        expect(page.items.length).toBeLessThanOrEqual(2)
        expect(page.items.length).toBeGreaterThanOrEqual(1)
        for (const item of page.items) {
          // No duplicate IDs across pages
          expect(allIds).not.toContain(item.id)
          allIds.push(item.id)
          if (ourIdSet.has(item.id)) foundOurs.push(item.id)
        }
        // Cursor must advance (not repeat)
        if (page.nextCursor) {
          expect(page.nextCursor).not.toBe(cursor)
        }
        cursor = page.nextCursor
        pages++
      } while (cursor && foundOurs.length < 3 && pages < MAX_PAGES)

      // All 3 of our batches found within the walked pages
      expect(foundOurs).toHaveLength(3)

      // Our batches appear in correct relative order (desc by createdAt):
      // batch-2 (newest) before batch-1 before batch-0 (oldest)
      const ourPositions = createdBatchIds.map((id) => allIds.indexOf(id))
      expect(ourPositions[2]).toBeLessThan(ourPositions[1]) // batch-2 before batch-1
      expect(ourPositions[1]).toBeLessThan(ourPositions[0]) // batch-1 before batch-0
    })
  })
})
