import { describe, it, expect } from 'vitest'
import { grokParser } from '../../lib/parsers/grok'

/**
 * Helper: builds a Grok timestamp in MongoDB extended JSON format.
 * Accepts a Date or epoch milliseconds.
 */
function grokTs(input: Date | number): { $date: { $numberLong: string } } {
  const ms = typeof input === 'number' ? input : input.getTime()
  return { $date: { $numberLong: String(ms) } }
}

/**
 * Helper: builds a minimal valid Grok export JSON string.
 */
function buildGrokExport(
  conversations: Array<{
    id?: string
    title?: string
    responses: Array<{
      _id?: string
      sender?: string
      message?: string
      create_time?: { $date: { $numberLong: string } }
    }>
  }>
): string {
  return JSON.stringify({
    conversations: conversations.map((c) => ({
      conversation: {
        id: c.id ?? 'conv-default',
        title: c.title ?? 'Test Conversation',
        create_time: '2024-01-15T10:00:00.000000Z',
      },
      responses: c.responses.map((r) => ({
        response: {
          _id: r._id ?? 'resp-default',
          conversation_id: c.id ?? 'conv-default',
          message: r.message ?? '',
          sender: r.sender ?? 'human',
          create_time: r.create_time ?? grokTs(new Date('2024-01-15T10:30:00.000Z')),
          model: 'grok-3',
        },
      })),
    })),
    projects: [],
    tasks: [],
  })
}

describe('grokParser', () => {
  describe('canParse', () => {
    it('returns true for valid Grok export', () => {
      const content = buildGrokExport([
        {
          id: 'conv-123',
          responses: [
            { _id: 'msg-1', message: 'Hello', sender: 'human' },
          ],
        },
      ])
      expect(grokParser.canParse(content)).toBe(true)
    })

    it('returns true for Grok export with empty responses', () => {
      const content = JSON.stringify({
        conversations: [
          {
            conversation: { id: 'conv-1', title: 'Test' },
            responses: [],
          },
        ],
        projects: [],
        tasks: [],
      })
      expect(grokParser.canParse(content)).toBe(true)
    })

    it('returns false for empty conversations array', () => {
      const content = JSON.stringify({
        conversations: [],
        projects: [],
        tasks: [],
      })
      expect(grokParser.canParse(content)).toBe(false)
    })

    it('returns false for non-object', () => {
      expect(grokParser.canParse('[]')).toBe(false)
    })

    it('returns false for object without conversations key', () => {
      expect(grokParser.canParse('{"data": []}')).toBe(false)
    })

    it('returns false for Claude format', () => {
      const content = JSON.stringify([
        { uuid: 'conv-1', chat_messages: [] },
      ])
      expect(grokParser.canParse(content)).toBe(false)
    })

    it('returns false for ChatGPT format', () => {
      const content = JSON.stringify([
        { mapping: {}, conversation_id: 'conv-1' },
      ])
      expect(grokParser.canParse(content)).toBe(false)
    })

    it('returns false for invalid JSON', () => {
      expect(grokParser.canParse('not json')).toBe(false)
    })

    it('returns false for object with conversations as non-array', () => {
      expect(grokParser.canParse('{"conversations": "not an array"}')).toBe(false)
    })
  })

  describe('parse', () => {
    it('parses a simple conversation with both roles', () => {
      const ts1 = new Date('2024-01-15T10:30:00.000Z')
      const ts2 = new Date('2024-01-15T10:30:05.000Z')

      const content = buildGrokExport([
        {
          id: 'conv-123',
          responses: [
            {
              _id: 'msg-1',
              message: 'Hello, how are you?',
              sender: 'human',
              create_time: grokTs(ts1),
            },
            {
              _id: 'msg-2',
              message: "I'm doing well, thank you!",
              sender: 'assistant',
              create_time: grokTs(ts2),
            },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.source).toBe('grok')
      expect(result.messages).toHaveLength(2)
      expect(result.warnings).toHaveLength(0)

      expect(result.messages[0]).toMatchObject({
        source: 'grok',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-1',
        role: 'user',
        text: 'Hello, how are you?',
      })

      expect(result.messages[1]).toMatchObject({
        source: 'grok',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-2',
        role: 'assistant',
        text: "I'm doing well, thank you!",
      })
    })

    it('includes both user and assistant messages', () => {
      const content = buildGrokExport([
        {
          id: 'conv-123',
          responses: [
            { _id: 'msg-1', message: 'User message', sender: 'human', create_time: grokTs(1705312200000) },
            { _id: 'msg-2', message: 'Assistant message', sender: 'assistant', create_time: grokTs(1705312201000) },
          ],
        },
      ])

      const result = grokParser.parse(content)
      const roles = result.messages.map((m) => m.role)

      expect(roles).toContain('user')
      expect(roles).toContain('assistant')
    })

    it('maps "human" sender to "user" role', () => {
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-1', message: 'Hello', sender: 'human', create_time: grokTs(1705312200000) },
          ],
        },
      ])

      const result = grokParser.parse(content)
      expect(result.messages[0].role).toBe('user')
    })

    it('maps "ASSISTANT" sender (uppercase) to "assistant" role', () => {
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-1', message: 'Response', sender: 'ASSISTANT', create_time: grokTs(1705312200000) },
          ],
        },
      ])

      const result = grokParser.parse(content)
      expect(result.messages[0].role).toBe('assistant')
    })

    it('skips unknown sender with warning', () => {
      const content = buildGrokExport([
        {
          id: 'conv-123',
          responses: [
            { _id: 'msg-1', message: 'System prompt', sender: 'system', create_time: grokTs(1705312200000) },
            { _id: 'msg-2', message: 'User message', sender: 'human', create_time: grokTs(1705312201000) },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('unknown sender')
      expect(result.warnings[0]).toContain('system')
    })

    it('skips empty messages', () => {
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-1', message: '', sender: 'human', create_time: grokTs(1705312200000) },
            { _id: 'msg-2', message: '   ', sender: 'human', create_time: grokTs(1705312201000) },
          ],
        },
      ])

      const result = grokParser.parse(content)
      expect(result.messages).toHaveLength(0)
    })

    it('handles messages with invalid timestamp with warning', () => {
      const content = JSON.stringify({
        conversations: [
          {
            conversation: { id: 'conv-123', title: 'Test' },
            responses: [
              {
                response: {
                  _id: 'msg-1',
                  conversation_id: 'conv-123',
                  message: 'Bad timestamp',
                  sender: 'human',
                  create_time: { $date: { $numberLong: 'not-a-number' } },
                },
              },
            ],
          },
        ],
        projects: [],
        tasks: [],
      })

      const result = grokParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('invalid timestamp')
    })

    it('handles messages with missing create_time with warning', () => {
      const content = JSON.stringify({
        conversations: [
          {
            conversation: { id: 'conv-123', title: 'Test' },
            responses: [
              {
                response: {
                  _id: 'msg-1',
                  conversation_id: 'conv-123',
                  message: 'No timestamp',
                  sender: 'human',
                  create_time: {},
                },
              },
            ],
          },
        ],
        projects: [],
        tasks: [],
      })

      const result = grokParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('invalid timestamp')
    })

    it('sorts messages by timestamp', () => {
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-2', message: 'Second', sender: 'human', create_time: grokTs(1705312202000) },
            { _id: 'msg-1', message: 'First', sender: 'human', create_time: grokTs(1705312200000) },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages[0].text).toBe('First')
      expect(result.messages[1].text).toBe('Second')
    })

    it('sorts by role (user before assistant) at same timestamp', () => {
      // Use the same ms value for both
      const sameTs = grokTs(1705312200000)
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-2', message: 'Assistant', sender: 'assistant', create_time: sameTs },
            { _id: 'msg-1', message: 'User', sender: 'human', create_time: sameTs },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages[0].role).toBe('user')
      expect(result.messages[1].role).toBe('assistant')
    })

    it('sorts by message ID as final tie-break', () => {
      const sameTs = grokTs(1705312200000)
      const content = buildGrokExport([
        {
          responses: [
            { _id: 'msg-b', message: 'B message', sender: 'human', create_time: sameTs },
            { _id: 'msg-a', message: 'A message', sender: 'human', create_time: sameTs },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages[0].sourceMessageId).toBe('msg-a')
      expect(result.messages[1].sourceMessageId).toBe('msg-b')
    })

    it('handles multiple conversations', () => {
      const content = buildGrokExport([
        {
          id: 'conv-1',
          responses: [
            { _id: 'msg-1', message: 'Conv 1 message', sender: 'human', create_time: grokTs(1705312200000) },
          ],
        },
        {
          id: 'conv-2',
          responses: [
            { _id: 'msg-2', message: 'Conv 2 message', sender: 'human', create_time: grokTs(1705312260000) },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].sourceConversationId).toBe('conv-1')
      expect(result.messages[1].sourceConversationId).toBe('conv-2')
    })

    it('converts MongoDB timestamps to UTC Date objects', () => {
      // 2024-01-15T10:30:00.123Z = 1705313400123 ms
      const epochMs = new Date('2024-01-15T10:30:00.123Z').getTime()
      const content = buildGrokExport([
        {
          responses: [
            {
              _id: 'msg-1',
              message: 'Hello',
              sender: 'human',
              create_time: grokTs(epochMs),
            },
          ],
        },
      ])

      const result = grokParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.123Z')
    })

    it('handles timestamps with whole-second precision (no fractional ms)', () => {
      // Epoch ms with no fractional component: exactly on the second
      const epochMs = new Date('2024-01-15T10:30:00.000Z').getTime()
      const content = buildGrokExport([
        {
          responses: [
            {
              _id: 'msg-1',
              message: 'Hello',
              sender: 'human',
              create_time: grokTs(epochMs),
            },
          ],
        },
      ])

      const result = grokParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('skips conversation without id with warning', () => {
      // First conversation must be valid (for isGrokShape), second lacks id
      const content = JSON.stringify({
        conversations: [
          {
            conversation: { id: 'conv-valid', title: 'Valid' },
            responses: [
              {
                response: {
                  _id: 'msg-0',
                  conversation_id: 'conv-valid',
                  message: 'Valid message',
                  sender: 'human',
                  create_time: grokTs(1705312200000),
                },
              },
            ],
          },
          {
            conversation: { title: 'No ID' },
            responses: [
              {
                response: {
                  _id: 'msg-1',
                  message: 'Hello',
                  sender: 'human',
                  create_time: grokTs(1705312201000),
                },
              },
            ],
          },
        ],
        projects: [],
        tasks: [],
      })

      const result = grokParser.parse(content)

      // Only the valid conversation's message should be parsed
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].sourceConversationId).toBe('conv-valid')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('without id')
    })

    it('throws on input without conversations array', () => {
      expect(() => grokParser.parse('{"data": []}')).toThrow(
        'Grok export must be an object with a "conversations" array'
      )
    })

    it('throws on array input (non-Grok shape)', () => {
      expect(() => grokParser.parse('[]')).toThrow(
        'Grok export must be an object with a "conversations" array'
      )
    })

    it('preserves source message and conversation IDs', () => {
      const content = buildGrokExport([
        {
          id: 'conv-abc-123',
          responses: [
            {
              _id: 'resp-xyz-789',
              message: 'Hello',
              sender: 'human',
              create_time: grokTs(1705312200000),
            },
          ],
        },
      ])

      const result = grokParser.parse(content)

      expect(result.messages[0].sourceConversationId).toBe('conv-abc-123')
      expect(result.messages[0].sourceMessageId).toBe('resp-xyz-789')
    })
  })
})
