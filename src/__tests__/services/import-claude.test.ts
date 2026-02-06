import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { importExport } from '../../lib/services/import'

/**
 * Integration tests for the Claude import pipeline.
 *
 * These tests require a running database (docker compose up -d).
 * They prove:
 * 1) Both roles imported from Claude fixture
 * 2) Deterministic ordering and stable IDs (re-import = no duplicates)
 * 3) Day bucketing: atoms on same dayDate create expected RawEntries per (source, dayDate)
 * 4) Timestamp normalization edge case: non-ms timestamp → normalized to ms
 */

/**
 * Builds a Claude export JSON string (Anthropic official data export format).
 */
function createClaudeExport(
  messages: Array<{
    uuid: string
    text: string
    sender: 'human' | 'assistant'
    created_at: string
    conversationId?: string
  }>,
  conversationId = 'conv-claude-test'
): string {
  return JSON.stringify([
    {
      uuid: messages[0]?.conversationId ?? conversationId,
      name: 'Test Claude Conversation',
      created_at: messages[0]?.created_at ?? '2024-01-15T10:00:00.000000+00:00',
      updated_at: messages[messages.length - 1]?.created_at ?? '2024-01-15T11:00:00.000000+00:00',
      chat_messages: messages.map((m) => ({
        uuid: m.uuid,
        text: m.text,
        sender: m.sender,
        created_at: m.created_at,
      })),
    },
  ])
}

/**
 * Builds a multi-conversation Claude export.
 */
function createMultiConvClaudeExport(
  conversations: Array<{
    conversationId: string
    messages: Array<{
      uuid: string
      text: string
      sender: 'human' | 'assistant'
      created_at: string
    }>
  }>
): string {
  return JSON.stringify(
    conversations.map((conv) => ({
      uuid: conv.conversationId,
      name: `Conversation ${conv.conversationId}`,
      created_at: conv.messages[0]?.created_at ?? '2024-01-15T10:00:00.000Z',
      updated_at: conv.messages[conv.messages.length - 1]?.created_at ?? '2024-01-15T11:00:00.000Z',
      chat_messages: conv.messages.map((m) => ({
        uuid: m.uuid,
        text: m.text,
        sender: m.sender,
        created_at: m.created_at,
      })),
    }))
  )
}

describe('Claude Import Pipeline', () => {
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
      const content = createClaudeExport([
        {
          uuid: 'msg-1',
          text: 'What is TypeScript?',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000000+00:00',
        },
        {
          uuid: 'msg-2',
          text: 'TypeScript is a typed superset of JavaScript.',
          sender: 'assistant',
          created_at: '2024-01-15T10:30:05.000000+00:00',
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('claude')
      expect(result.created.messageAtoms).toBe(2)
      expect(result.importBatch.stats.message_count).toBe(2)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { timestampUtc: 'asc' },
      })

      expect(atoms).toHaveLength(2)
      const roles = new Set(atoms.map((a) => a.role))
      expect(roles).toEqual(new Set(['USER', 'ASSISTANT']))
      expect(atoms[0].source).toBe('CLAUDE')
      expect(atoms[1].source).toBe('CLAUDE')
    })
  })

  describe('deterministic ordering and stable IDs', () => {
    it('same file imported twice produces no duplicate MessageAtoms', async () => {
      const content = createClaudeExport([
        {
          uuid: 'msg-1',
          text: 'Hello Claude!',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000Z',
        },
        {
          uuid: 'msg-2',
          text: 'Hello! How can I help?',
          sender: 'assistant',
          created_at: '2024-01-15T10:30:01.000Z',
        },
      ])

      // First import
      const result1 = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result1.importBatch.id)
      expect(result1.created.messageAtoms).toBe(2)

      // Second import of exact same content
      const result2 = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
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
      const content = createClaudeExport([
        {
          uuid: 'msg-stable',
          text: 'Deterministic test',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000Z',
        },
      ])

      const result1 = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
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
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result2.importBatch.id)

      expect(result2.created.messageAtoms).toBe(0)
      expect(result2.warnings[0]).toContain('1 duplicate')
    })
  })

  describe('day bucketing', () => {
    it('creates one RawEntry per (source, dayDate)', async () => {
      // Messages spanning two UTC days
      const content = createClaudeExport([
        {
          uuid: 'msg-day1',
          text: 'Day 1 message',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000Z',
        },
        {
          uuid: 'msg-day2',
          text: 'Day 2 message',
          sender: 'human',
          created_at: '2024-01-16T10:30:00.000Z',
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
        timezone: 'UTC',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.created.rawEntries).toBe(2)

      const rawEntries = await prisma.rawEntry.findMany({
        where: { importBatchId: result.importBatch.id },
        orderBy: { dayDate: 'asc' },
      })

      expect(rawEntries).toHaveLength(2)
      expect(rawEntries[0].source).toBe('CLAUDE')
      expect(rawEntries[1].source).toBe('CLAUDE')
    })

    it('uses timezone for day bucketing', async () => {
      // 06:00 UTC on Jan 16 = 22:00 PST on Jan 15
      const content = createClaudeExport([
        {
          uuid: 'msg-tz',
          text: 'Timezone test',
          sender: 'human',
          created_at: '2024-01-16T06:00:00.000Z',
        },
      ])

      const resultUtc = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
        timezone: 'UTC',
      })
      createdBatchIds.push(resultUtc.importBatch.id)
      expect(resultUtc.importBatch.stats.coverage_start).toBe('2024-01-16')

      // Need different message to avoid dedup
      const content2 = createClaudeExport(
        [
          {
            uuid: 'msg-tz-pst',
            text: 'Timezone test PST',
            sender: 'human',
            created_at: '2024-01-16T06:00:00.000Z',
            conversationId: 'conv-tz-pst',
          },
        ],
        'conv-tz-pst'
      )

      const resultPst = await importExport({
        content: content2,
        filename: 'conversations2.json',
        fileSizeBytes: content2.length,
        sourceOverride: 'claude',
        timezone: 'America/Los_Angeles',
      })
      createdBatchIds.push(resultPst.importBatch.id)
      expect(resultPst.importBatch.stats.coverage_start).toBe('2024-01-15')
    })
  })

  describe('timestamp normalization', () => {
    it('normalizes timestamp without milliseconds to .000Z', async () => {
      const content = createClaudeExport([
        {
          uuid: 'msg-no-ms',
          text: 'No milliseconds',
          sender: 'human',
          // ISO without milliseconds
          created_at: '2024-01-15T10:30:00Z',
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result.importBatch.id)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(1)
      // The stored timestamp should be a proper Date
      expect(atoms[0].timestampUtc).toBeInstanceOf(Date)
      // When serialized to ISO, should have millisecond precision
      expect(atoms[0].timestampUtc.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('normalizes timestamp with timezone offset to UTC', async () => {
      const content = createClaudeExport([
        {
          uuid: 'msg-offset',
          text: 'With offset',
          sender: 'human',
          // 10:30 at +05:00 = 05:30 UTC
          created_at: '2024-01-15T10:30:00.000+05:00',
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result.importBatch.id)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(1)
      expect(atoms[0].timestampUtc.toISOString()).toBe('2024-01-15T05:30:00.000Z')
    })

    it('normalizes microsecond precision to milliseconds', async () => {
      const content = createClaudeExport([
        {
          uuid: 'msg-micro',
          text: 'Microsecond precision',
          sender: 'human',
          // Claude exports may include microsecond precision
          created_at: '2024-01-15T10:30:00.123456+00:00',
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
      })
      createdBatchIds.push(result.importBatch.id)

      const atoms = await prisma.messageAtom.findMany({
        where: { importBatchId: result.importBatch.id },
      })

      expect(atoms).toHaveLength(1)
      // JavaScript Date truncates to ms precision
      expect(atoms[0].timestampUtc.toISOString()).toBe('2024-01-15T10:30:00.123Z')
    })
  })

  describe('import stats', () => {
    it('reports correct stats for Claude import', async () => {
      const content = createMultiConvClaudeExport([
        {
          conversationId: 'conv-1',
          messages: [
            { uuid: 'msg-1', text: 'Hello', sender: 'human', created_at: '2024-01-15T10:00:00.000Z' },
            { uuid: 'msg-2', text: 'Hi!', sender: 'assistant', created_at: '2024-01-15T10:00:01.000Z' },
          ],
        },
        {
          conversationId: 'conv-2',
          messages: [
            { uuid: 'msg-3', text: 'Another day', sender: 'human', created_at: '2024-01-16T10:00:00.000Z' },
          ],
        },
      ])

      const result = await importExport({
        content,
        filename: 'conversations.json',
        fileSizeBytes: content.length,
        sourceOverride: 'claude',
        timezone: 'UTC',
      })
      createdBatchIds.push(result.importBatch.id)

      expect(result.importBatch.source).toBe('claude')
      expect(result.importBatch.stats.message_count).toBe(3)
      expect(result.importBatch.stats.day_count).toBe(2)
      expect(result.importBatch.stats.coverage_start).toBe('2024-01-15')
      expect(result.importBatch.stats.coverage_end).toBe('2024-01-16')
      expect(result.importBatch.stats.per_source_counts).toEqual({ claude: 3 })
    })
  })
})
