import { describe, it, expect } from 'vitest'
import { claudeParser } from '../../lib/parsers/claude'

/**
 * Helper: builds a minimal valid Claude export JSON string.
 */
function buildClaudeExport(
  conversations: Array<{
    uuid?: string
    name?: string
    chat_messages: Array<{
      uuid?: string
      text?: string
      sender?: string
      created_at?: string
    }>
  }>
): string {
  return JSON.stringify(
    conversations.map((c) => ({
      uuid: c.uuid ?? 'conv-default',
      name: c.name ?? 'Test Conversation',
      created_at: '2024-01-15T10:00:00.000000+00:00',
      updated_at: '2024-01-15T11:00:00.000000+00:00',
      chat_messages: c.chat_messages.map((m) => ({
        uuid: m.uuid ?? 'msg-default',
        text: m.text ?? '',
        sender: m.sender ?? 'human',
        created_at: m.created_at ?? '2024-01-15T10:30:00.000000+00:00',
      })),
    }))
  )
}

describe('claudeParser', () => {
  describe('canParse', () => {
    it('returns true for valid Claude export', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-123',
          chat_messages: [
            { uuid: 'msg-1', text: 'Hello', sender: 'human' },
          ],
        },
      ])
      expect(claudeParser.canParse(content)).toBe(true)
    })

    it('returns false for empty array (ambiguous)', () => {
      expect(claudeParser.canParse('[]')).toBe(false)
    })

    it('returns false for non-array', () => {
      expect(claudeParser.canParse('{}')).toBe(false)
    })

    it('returns false for array without uuid', () => {
      const content = JSON.stringify([{ name: 'Test', chat_messages: [] }])
      expect(claudeParser.canParse(content)).toBe(false)
    })

    it('returns false for array without chat_messages', () => {
      const content = JSON.stringify([{ uuid: 'conv-1', name: 'Test' }])
      expect(claudeParser.canParse(content)).toBe(false)
    })

    it('returns false for ChatGPT format', () => {
      const content = JSON.stringify([
        { mapping: {}, conversation_id: 'conv-1' },
      ])
      expect(claudeParser.canParse(content)).toBe(false)
    })

    it('returns false for invalid JSON', () => {
      expect(claudeParser.canParse('not json')).toBe(false)
    })
  })

  describe('parse', () => {
    it('parses a simple conversation with both roles', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-123',
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Hello, how are you?',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.000000+00:00',
            },
            {
              uuid: 'msg-2',
              text: "I'm doing well, thank you!",
              sender: 'assistant',
              created_at: '2024-01-15T10:30:01.000000+00:00',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.source).toBe('claude')
      expect(result.messages).toHaveLength(2)
      expect(result.warnings).toHaveLength(0)

      expect(result.messages[0]).toMatchObject({
        source: 'claude',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-1',
        role: 'user',
        text: 'Hello, how are you?',
      })

      expect(result.messages[1]).toMatchObject({
        source: 'claude',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-2',
        role: 'assistant',
        text: "I'm doing well, thank you!",
      })
    })

    it('includes both user and assistant messages', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-123',
          chat_messages: [
            { uuid: 'msg-1', text: 'User message', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
            { uuid: 'msg-2', text: 'Assistant message', sender: 'assistant', created_at: '2024-01-15T10:30:01.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      const roles = result.messages.map((m) => m.role)

      expect(roles).toContain('user')
      expect(roles).toContain('assistant')
    })

    it('maps "human" sender to "user" role', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            { uuid: 'msg-1', text: 'Hello', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      expect(result.messages[0].role).toBe('user')
    })

    it('skips unknown sender with warning', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-123',
          chat_messages: [
            { uuid: 'msg-1', text: 'System prompt', sender: 'system', created_at: '2024-01-15T10:30:00.000Z' },
            { uuid: 'msg-2', text: 'User message', sender: 'human', created_at: '2024-01-15T10:30:01.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('unknown sender')
      expect(result.warnings[0]).toContain('system')
    })

    it('skips empty messages', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            { uuid: 'msg-1', text: '', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
            { uuid: 'msg-2', text: '   ', sender: 'human', created_at: '2024-01-15T10:30:01.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      expect(result.messages).toHaveLength(0)
    })

    it('handles messages without timestamp with warning', () => {
      const content = JSON.stringify([
        {
          uuid: 'conv-123',
          name: 'Test',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-01-15T11:00:00.000Z',
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'No timestamp',
              sender: 'human',
              created_at: '',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('without timestamp')
    })

    it('handles messages with invalid timestamp with warning', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-123',
          chat_messages: [
            { uuid: 'msg-1', text: 'Bad ts', sender: 'human', created_at: 'not-a-date' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('invalid timestamp')
    })

    it('sorts messages by timestamp', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            { uuid: 'msg-2', text: 'Second', sender: 'human', created_at: '2024-01-15T10:30:02.000Z' },
            { uuid: 'msg-1', text: 'First', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages[0].text).toBe('First')
      expect(result.messages[1].text).toBe('Second')
    })

    it('sorts by role (user before assistant) at same timestamp', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            { uuid: 'msg-2', text: 'Assistant', sender: 'assistant', created_at: '2024-01-15T10:30:00.000Z' },
            { uuid: 'msg-1', text: 'User', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages[0].role).toBe('user')
      expect(result.messages[1].role).toBe('assistant')
    })

    it('handles multiple conversations', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-1',
          chat_messages: [
            { uuid: 'msg-1', text: 'Conv 1 message', sender: 'human', created_at: '2024-01-15T10:00:00.000Z' },
          ],
        },
        {
          uuid: 'conv-2',
          chat_messages: [
            { uuid: 'msg-2', text: 'Conv 2 message', sender: 'human', created_at: '2024-01-15T11:00:00.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].sourceConversationId).toBe('conv-1')
      expect(result.messages[1].sourceConversationId).toBe('conv-2')
    })

    it('converts ISO timestamps to UTC Date objects', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Hello',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.123000+00:00',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.123Z')
    })

    it('handles timestamps with timezone offset (converts to UTC)', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Hello',
              sender: 'human',
              // 10:30 at +05:00 = 05:30 UTC
              created_at: '2024-01-15T10:30:00.000+05:00',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      expect(timestamp.toISOString()).toBe('2024-01-15T05:30:00.000Z')
    })

    it('handles timestamps without milliseconds (normalized to .000)', () => {
      const content = buildClaudeExport([
        {
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Hello',
              sender: 'human',
              created_at: '2024-01-15T10:30:00Z',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      // Date.toISOString() always includes .000Z for whole-second timestamps
      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('handles timestamps with microsecond precision (truncated to ms)', () => {
      // Claude exports sometimes include microsecond precision
      const content = buildClaudeExport([
        {
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Hello',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.123456+00:00',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      // JavaScript Date only has ms precision; microseconds are truncated
      expect(timestamp.toISOString()).toBe('2024-01-15T10:30:00.123Z')
    })

    it('skips conversation without uuid with warning', () => {
      const content = JSON.stringify([
        {
          name: 'No UUID',
          created_at: '2024-01-15T10:00:00.000Z',
          updated_at: '2024-01-15T11:00:00.000Z',
          chat_messages: [
            { uuid: 'msg-1', text: 'Hello', sender: 'human', created_at: '2024-01-15T10:30:00.000Z' },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('without uuid')
    })

    it('throws on non-array input', () => {
      expect(() => claudeParser.parse('{}')).toThrow(
        'Claude export must be an array of conversations'
      )
    })

    it('preserves source message and conversation IDs', () => {
      const content = buildClaudeExport([
        {
          uuid: 'conv-abc-123',
          chat_messages: [
            {
              uuid: 'msg-xyz-789',
              text: 'Hello',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.000Z',
            },
          ],
        },
      ])

      const result = claudeParser.parse(content)

      expect(result.messages[0].sourceConversationId).toBe('conv-abc-123')
      expect(result.messages[0].sourceMessageId).toBe('msg-xyz-789')
    })
  })
})
