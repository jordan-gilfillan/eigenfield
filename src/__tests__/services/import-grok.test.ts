import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { importExport } from '../../lib/services/import'

/**
 * Integration tests for the Grok import pipeline.
 *
 * These tests require a running database (docker compose up -d).
 * They prove:
 * 1) Both roles imported from Grok fixture
 * 2) Deterministic ordering and stable IDs (re-import = no duplicates)
 * 3) Day bucketing: atoms on same dayDate create expected RawEntries per (source, dayDate)
 * 4) Timestamp normalization: MongoDB extended JSON timestamps normalized correctly
 * 5) Import stats accuracy
 */

/**
 * Helper: builds a Grok timestamp in MongoDB extended JSON format.
 */
function grokTs(input: Date | number): { $date: { $numberLong: string } } {
  const ms = typeof input === 'number' ? input : input.getTime()
  return { $date: { $numberLong: String(ms) } }
}

/**
 * Builds a Grok export JSON string.
 */
function createGrokExport(
  messages: Array<{
    _id: string
    message: string
    sender: 'human' | 'assistant'
    create_time: { $date: { $numberLong: string } }
    conversationId?: string
  }>,
  conversationId = 'conv-grok-test'
): string {
  return JSON.stringify({
    conversations: [
      {
        conversation: {
          id: messages[0]?.conversationId ?? conversationId,
          title: 'Test Grok Conversation',
          create_time: '2024-01-15T10:00:00.000000Z',
        },
        responses: messages.map((m) => ({
          response: {
            _id: m._id,
            conversation_id: m.conversationId ?? conversationId,
            message: m.message,
            sender: m.sender,
            create_time: m.create_time,
            model: 'grok-3',
          },
        })),
      },
    ],
    projects: [],
    tasks: [],
  })
}

/**
 * Builds a multi-conversation Grok export.
 */
function createMultiConvGrokExport(
  conversations: Array<{
    conversationId: string
    messages: Array<{
      _id: string
      message: string
      sender: 'human' | 'assistant'
      create_time: { $date: { $numberLong: string } }
    }>
  }>
): string {
  return JSON.stringify({
    conversations: conversations.map((conv) => ({
      conversation: {
        id: conv.conversationId,
        title: `Conversation ${conv.conversationId}`,
        create_time: '2024-01-15T10:00:00.000000Z',
      },
      responses: conv.messages.map((m) => ({
        response: {
          _id: m._id,
          conversation_id: conv.conversationId,
          message: m.message,
          sender: m.sender,
          create_time: m.create_time,
          model: 'grok-3',
        },
      })),
    })),
    projects: [],
    tasks: [],
  })
}

describe('Grok Import Pipeline', () => {
  const createdBatchIds: string[] = []

  afterEach(async () => {
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

  describe('imports both roles (user + assistant)', () => {
    it('creates MessageAtoms for both human and assistant messages', async () => {
      const content = createGrokExport([
        {
          _id: 'msg-1',
          message: 'What is TypeScript?',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-15T10:30:00.000Z')),
        },
        {
          _id: 'msg-2',
          message: 'TypeScript is a typed superset of JavaScript.',
          sender: 'assistant',
          create_time: grokTs(new Date('2024-01-15T10:30:05.000Z')),
        },
      ])

      const result = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('grok')
      expect(result.created.messageAtoms).toBe(2)
      expect(result.importBatch.stats.message_count).toBe(2)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { timestampUtc: 'asc' },
      })

      expect(atoms).toHaveLength(2)
      const roles = new Set(atoms.map((a) => a.role))
      expect(roles).toEqual(new Set(['USER', 'ASSISTANT']))
      expect(atoms[0].source).toBe('GROK')
      expect(atoms[1].source).toBe('GROK')
    })
  })

  describe('deterministic ordering and stable IDs', () => {
    it('same file imported twice produces no duplicate MessageAtoms', async () => {
      const content = createGrokExport([
        {
          _id: 'msg-1',
          message: 'Hello Grok!',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-15T10:30:00.000Z')),
        },
        {
          _id: 'msg-2',
          message: 'Hello! How can I help?',
          sender: 'assistant',
          create_time: grokTs(new Date('2024-01-15T10:30:01.000Z')),
        },
      ])

      // First import
      const result1 = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result1.importBatch.id)
      expect(result1.created.messageAtoms).toBe(2)

      // Second import of exact same content
      const result2 = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result2.importBatch.id)

      // Should report 0 new atoms (all duplicates)
      expect(result2.created.messageAtoms).toBe(0)
      expect(result2.warnings).toContainEqual(
        expect.stringContaining('duplicate')
      )

      // Total atoms in DB should still be 2
      const allAtoms = await prisma.messageAtom.findMany({
        where: {
          importBatchId: { in: createdBatchIds },
        },
      })
      expect(allAtoms).toHaveLength(2)
    })

    it('stable IDs are deterministic (same input → same atomStableId)', async () => {
      const content = createGrokExport([
        {
          _id: 'msg-stable',
          message: 'Deterministic test',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-15T10:30:00.000Z')),
        },
      ])

      const result1 = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result1.importBatch.id)

      const atoms1 = await prisma.messageAtom.findMany({
        where: { importBatchId: result1.importBatch.id },
      })
      expect(atoms1).toHaveLength(1)

      // Second import — atoms won't be created (dedup), but we can verify
      // by checking the duplicate skip count matches
      const result2 = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result2.importBatch.id)

      expect(result2.created.messageAtoms).toBe(0)
      expect(result2.warnings[0]).toContain('1 duplicate')
    })
  })

  describe('day bucketing', () => {
    it('creates one RawEntry per (source, dayDate)', async () => {
      // Messages spanning two UTC days
      const content = createGrokExport([
        {
          _id: 'msg-day1',
          message: 'Day 1 message',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-15T10:30:00.000Z')),
        },
        {
          _id: 'msg-day2',
          message: 'Day 2 message',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-16T10:30:00.000Z')),
        },
      ])

      const result = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
        timezone: 'UTC',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.created.rawEntries).toBe(2)

      const rawEntries = await prisma.rawEntry.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { dayDate: 'asc' },
      })

      expect(rawEntries).toHaveLength(2)
      expect(rawEntries[0].source).toBe('GROK')
      expect(rawEntries[1].source).toBe('GROK')
    })

    it('uses timezone for day bucketing', async () => {
      // 06:00 UTC on Jan 16 = 22:00 PST on Jan 15
      const content = createGrokExport([
        {
          _id: 'msg-tz-grok',
          message: 'Timezone test',
          sender: 'human',
          create_time: grokTs(new Date('2024-01-16T06:00:00.000Z')),
        },
      ])

      const resultUtc = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
        timezone: 'UTC',
      })
      createdBatchIds.push(resultUtc.importBatch.id)
      expect(resultUtc.importBatch.stats.coverage_start).toBe('2024-01-16')

      // Need different message to avoid dedup
      const content2 = createGrokExport(
        [
          {
            _id: 'msg-tz-grok-pst',
            message: 'Timezone test PST',
            sender: 'human',
            create_time: grokTs(new Date('2024-01-16T06:00:00.000Z')),
            conversationId: 'conv-tz-pst',
          },
        ],
        'conv-tz-pst'
      )

      const resultPst = await importExport({
        content: content2,
        filename: 'grok-export2.json',
        fileSizeBytes: content2.length,
        sourceOverride: 'grok',
        timezone: 'America/Los_Angeles',
      })
      createdBatchIds.push(resultPst.importBatch.id)
      expect(resultPst.importBatch.stats.coverage_start).toBe('2024-01-15')
    })
  })

  describe('timestamp normalization', () => {
    it('normalizes MongoDB epoch ms timestamp to proper Date', async () => {
      // 2024-01-15T10:30:00.000Z = epoch ms 1705313400000
      const epochMs = new Date('2024-01-15T10:30:00.000Z').getTime()
      const content = createGrokExport([
        {
          _id: 'msg-epoch',
          message: 'Epoch test',
          sender: 'human',
          create_time: grokTs(epochMs),
        },
      ])

      const result = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result.importBatch.id)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(1)
      expect(atoms[0].timestampUtc).toBeInstanceOf(Date)
      expect(atoms[0].timestampUtc.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('preserves millisecond precision from epoch timestamp', async () => {
      // 2024-01-15T10:30:00.123Z
      const epochMs = new Date('2024-01-15T10:30:00.123Z').getTime()
      const content = createGrokExport([
        {
          _id: 'msg-ms-precision',
          message: 'Millisecond precision test',
          sender: 'human',
          create_time: grokTs(epochMs),
        },
      ])

      const result = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
      })
      createdBatchIds.push(result.importBatch.id)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(1)
      expect(atoms[0].timestampUtc.toISOString()).toBe('2024-01-15T10:30:00.123Z')
    })
  })

  describe('import stats', () => {
    it('reports correct stats for Grok import', async () => {
      const content = createMultiConvGrokExport([
        {
          conversationId: 'conv-1',
          messages: [
            { _id: 'msg-1', message: 'Hello', sender: 'human', create_time: grokTs(new Date('2024-01-15T10:00:00.000Z')) },
            { _id: 'msg-2', message: 'Hi!', sender: 'assistant', create_time: grokTs(new Date('2024-01-15T10:00:01.000Z')) },
          ],
        },
        {
          conversationId: 'conv-2',
          messages: [
            { _id: 'msg-3', message: 'Another day', sender: 'human', create_time: grokTs(new Date('2024-01-16T10:00:00.000Z')) },
          ],
        },
      ])

      const result = await importExport({
        content,
        filename: 'grok-export.json',
        fileSizeBytes: content.length,
        sourceOverride: 'grok',
        timezone: 'UTC',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('grok')
      expect(result.importBatch.stats.message_count).toBe(3)
      expect(result.importBatch.stats.day_count).toBe(2)
      expect(result.importBatch.stats.coverage_start).toBe('2024-01-15')
      expect(result.importBatch.stats.coverage_end).toBe('2024-01-16')
      expect(result.importBatch.stats.per_source_counts).toEqual({ grok: 3 })
    })
  })
})
