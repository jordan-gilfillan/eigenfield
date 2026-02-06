import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '../../lib/db'
import { importExport } from '../../lib/services/import'
import {
  UnsupportedFormatError,
  AmbiguousFormatError,
} from '../../lib/parsers'

/**
 * Integration tests for parser auto-detection in the import pipeline.
 *
 * These tests require a running database (docker compose up -d).
 * They prove:
 * 1) Each format is correctly auto-detected without sourceOverride
 * 2) Non-matching JSON returns UnsupportedFormatError
 * 3) Synthetic ambiguous JSON returns AmbiguousFormatError with matched ids
 * 4) sourceOverride bypasses auto-detection
 * 5) Import with auto-detected source stores correct source in ImportBatch
 *
 * PR-7.3: Parser auto-detection + registry wiring
 */

// =============================================================================
// Fixture helpers
// =============================================================================

function buildChatGPTExport(): string {
  return JSON.stringify([
    {
      title: 'Auto-detect Test',
      create_time: 1705316400,
      update_time: 1705316500,
      mapping: {
        'node-1': {
          id: 'node-1',
          message: {
            id: 'msg-chatgpt-ad-1',
            author: { role: 'user' },
            create_time: 1705316400.123,
            content: { content_type: 'text', parts: ['ChatGPT auto-detect test'] },
          },
          parent: null,
          children: ['node-2'],
        },
        'node-2': {
          id: 'node-2',
          message: {
            id: 'msg-chatgpt-ad-2',
            author: { role: 'assistant' },
            create_time: 1705316401.456,
            content: { content_type: 'text', parts: ['Hello from ChatGPT'] },
          },
          parent: 'node-1',
          children: [],
        },
      },
      conversation_id: 'conv-chatgpt-autodetect',
    },
  ])
}

function buildClaudeExport(): string {
  return JSON.stringify([
    {
      uuid: 'conv-claude-autodetect',
      name: 'Claude Auto-detect',
      created_at: '2024-01-15T10:00:00.000000+00:00',
      updated_at: '2024-01-15T11:00:00.000000+00:00',
      chat_messages: [
        {
          uuid: 'msg-claude-ad-1',
          text: 'Claude auto-detect test',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000000+00:00',
        },
        {
          uuid: 'msg-claude-ad-2',
          text: 'Hello from Claude',
          sender: 'assistant',
          created_at: '2024-01-15T10:31:00.000000+00:00',
        },
      ],
    },
  ])
}

function buildGrokExport(): string {
  return JSON.stringify({
    conversations: [
      {
        conversation: {
          id: 'conv-grok-autodetect',
          title: 'Grok Auto-detect',
          create_time: '2024-01-15T10:00:00.000000Z',
        },
        responses: [
          {
            response: {
              _id: 'msg-grok-ad-1',
              conversation_id: 'conv-grok-autodetect',
              message: 'Grok auto-detect test',
              sender: 'human',
              create_time: { $date: { $numberLong: '1705312200000' } },
            },
          },
          {
            response: {
              _id: 'msg-grok-ad-2',
              conversation_id: 'conv-grok-autodetect',
              message: 'Hello from Grok',
              sender: 'assistant',
              create_time: { $date: { $numberLong: '1705312260000' } },
            },
          },
        ],
      },
    ],
    projects: [],
    tasks: [],
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('Import auto-detection (integration)', () => {
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

  // ===========================================================================
  // Auto-detect each format without sourceOverride
  // ===========================================================================

  it('auto-detects ChatGPT export without sourceOverride', async () => {
    const result = await importExport({
      content: buildChatGPTExport(),
      filename: 'conversations.json',
      fileSizeBytes: 1024,
      // no sourceOverride
    })
    createdBatchIds.push(result.importBatch.id)

    expect(result.importBatch.source).toBe('chatgpt')
    expect(result.created.messageAtoms).toBe(2)
  })

  it('auto-detects Claude export without sourceOverride', async () => {
    const result = await importExport({
      content: buildClaudeExport(),
      filename: 'claude-export.json',
      fileSizeBytes: 512,
    })
    createdBatchIds.push(result.importBatch.id)

    expect(result.importBatch.source).toBe('claude')
    expect(result.created.messageAtoms).toBe(2)
  })

  it('auto-detects Grok export without sourceOverride', async () => {
    const result = await importExport({
      content: buildGrokExport(),
      filename: 'grok-export.json',
      fileSizeBytes: 768,
    })
    createdBatchIds.push(result.importBatch.id)

    expect(result.importBatch.source).toBe('grok')
    expect(result.created.messageAtoms).toBe(2)
  })

  // ===========================================================================
  // sourceOverride bypasses auto-detection
  // ===========================================================================

  it('uses sourceOverride when provided (ChatGPT)', async () => {
    const result = await importExport({
      content: buildChatGPTExport(),
      filename: 'conversations.json',
      fileSizeBytes: 1024,
      sourceOverride: 'chatgpt',
    })
    createdBatchIds.push(result.importBatch.id)

    expect(result.importBatch.source).toBe('chatgpt')
    expect(result.created.messageAtoms).toBe(2)
  })

  // ===========================================================================
  // Non-matching JSON → UnsupportedFormatError
  // ===========================================================================

  it('throws UnsupportedFormatError for unrecognized JSON', async () => {
    await expect(
      importExport({
        content: JSON.stringify({ unknown: 'format', data: [1, 2, 3] }),
        filename: 'mystery.json',
        fileSizeBytes: 100,
      })
    ).rejects.toThrow(UnsupportedFormatError)
  })

  it('throws UnsupportedFormatError for invalid JSON', async () => {
    await expect(
      importExport({
        content: 'not valid json',
        filename: 'bad.json',
        fileSizeBytes: 14,
      })
    ).rejects.toThrow(UnsupportedFormatError)
  })

  // ===========================================================================
  // Ambiguous format → AmbiguousFormatError
  // ===========================================================================

  it('throws AmbiguousFormatError for synthetic data matching multiple parsers', async () => {
    // Craft JSON that satisfies both ChatGPT and Claude canParse():
    // - Array with first element having 'mapping' + 'conversation_id' (ChatGPT)
    //   AND 'uuid' + 'chat_messages' (Claude)
    const ambiguous = JSON.stringify([
      {
        // ChatGPT markers
        mapping: {
          'node-1': {
            id: 'node-1',
            message: {
              id: 'msg-ambig-1',
              author: { role: 'user' },
              create_time: 1705316400,
              content: { content_type: 'text', parts: ['Ambiguous message'] },
            },
            parent: null,
            children: [],
          },
        },
        conversation_id: 'conv-ambig',
        // Claude markers
        uuid: 'conv-ambig',
        chat_messages: [
          {
            uuid: 'msg-ambig-1',
            text: 'Ambiguous message',
            sender: 'human',
            created_at: '2024-01-15T10:30:00.000000+00:00',
          },
        ],
        name: 'Ambiguous Test',
        created_at: '2024-01-15T10:00:00.000000+00:00',
        updated_at: '2024-01-15T11:00:00.000000+00:00',
      },
    ])

    try {
      await importExport({
        content: ambiguous,
        filename: 'ambiguous.json',
        fileSizeBytes: 500,
      })
      expect.fail('Should have thrown AmbiguousFormatError')
    } catch (e) {
      expect(e).toBeInstanceOf(AmbiguousFormatError)
      const err = e as AmbiguousFormatError
      expect(err.code).toBe('AMBIGUOUS_FORMAT')
      expect(err.matched).toContain('chatgpt')
      expect(err.matched).toContain('claude')
    }
  })

  // ===========================================================================
  // ImportBatch stores correct detected source
  // ===========================================================================

  it('ImportBatch.source matches auto-detected parser for Claude', async () => {
    const result = await importExport({
      content: buildClaudeExport(),
      filename: 'claude.json',
      fileSizeBytes: 512,
    })
    createdBatchIds.push(result.importBatch.id)

    // Verify in DB
    const batch = await prisma.importBatch.findUnique({
      where: { id: result.importBatch.id },
    })
    expect(batch).not.toBeNull()
    expect(batch!.source).toBe('CLAUDE') // DB stores uppercase
  })

  it('ImportBatch.source matches auto-detected parser for Grok', async () => {
    const result = await importExport({
      content: buildGrokExport(),
      filename: 'grok.json',
      fileSizeBytes: 768,
    })
    createdBatchIds.push(result.importBatch.id)

    const batch = await prisma.importBatch.findUnique({
      where: { id: result.importBatch.id },
    })
    expect(batch).not.toBeNull()
    expect(batch!.source).toBe('GROK')
  })

  // ===========================================================================
  // Re-import idempotency preserved with auto-detection
  // ===========================================================================

  it('re-import with auto-detection preserves idempotency', async () => {
    const content = buildChatGPTExport()

    const result1 = await importExport({
      content,
      filename: 'test.json',
      fileSizeBytes: 1024,
    })
    createdBatchIds.push(result1.importBatch.id)
    expect(result1.created.messageAtoms).toBe(2)

    // Re-import same content — atoms should be deduplicated
    const result2 = await importExport({
      content,
      filename: 'test.json',
      fileSizeBytes: 1024,
    })
    createdBatchIds.push(result2.importBatch.id)
    expect(result2.created.messageAtoms).toBe(0)
    expect(result2.warnings).toContain(
      'Skipped 2 duplicate messages (already imported)'
    )
  })
})
