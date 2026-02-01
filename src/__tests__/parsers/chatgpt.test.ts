import { describe, it, expect } from 'vitest'
import { chatgptParser } from '../../lib/parsers/chatgpt'

describe('chatgptParser', () => {
  describe('canParse', () => {
    it('returns true for valid ChatGPT export', () => {
      const content = JSON.stringify([
        {
          title: 'Test Conversation',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {},
          conversation_id: 'conv-123',
        },
      ])
      expect(chatgptParser.canParse(content)).toBe(true)
    })

    it('returns true for empty array', () => {
      expect(chatgptParser.canParse('[]')).toBe(true)
    })

    it('returns false for non-array', () => {
      expect(chatgptParser.canParse('{}')).toBe(false)
    })

    it('returns false for array without mapping', () => {
      const content = JSON.stringify([{ title: 'Test' }])
      expect(chatgptParser.canParse(content)).toBe(false)
    })

    it('returns false for invalid JSON', () => {
      expect(chatgptParser.canParse('not json')).toBe(false)
    })
  })

  describe('parse', () => {
    it('parses a simple conversation', () => {
      const content = JSON.stringify([
        {
          title: 'Test Conversation',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: {
                  content_type: 'text',
                  parts: ['Hello, how are you?'],
                },
              },
              parent: null,
              children: ['node-2'],
            },
            'node-2': {
              id: 'node-2',
              message: {
                id: 'msg-2',
                author: { role: 'assistant' },
                create_time: 1705316401.0,
                content: {
                  content_type: 'text',
                  parts: ["I'm doing well, thank you!"],
                },
              },
              parent: 'node-1',
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.source).toBe('chatgpt')
      expect(result.messages).toHaveLength(2)
      expect(result.warnings).toHaveLength(0)

      expect(result.messages[0]).toMatchObject({
        source: 'chatgpt',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-1',
        role: 'user',
        text: 'Hello, how are you?',
      })

      expect(result.messages[1]).toMatchObject({
        source: 'chatgpt',
        sourceConversationId: 'conv-123',
        sourceMessageId: 'msg-2',
        role: 'assistant',
        text: "I'm doing well, thank you!",
      })
    })

    it('includes both user and assistant messages', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: ['User message'] },
              },
              parent: null,
              children: ['node-2'],
            },
            'node-2': {
              id: 'node-2',
              message: {
                id: 'msg-2',
                author: { role: 'assistant' },
                create_time: 1705316401.0,
                content: { content_type: 'text', parts: ['Assistant message'] },
              },
              parent: 'node-1',
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)
      const roles = result.messages.map((m) => m.role)

      expect(roles).toContain('user')
      expect(roles).toContain('assistant')
    })

    it('skips system messages', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'system' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: ['System prompt'] },
              },
              parent: null,
              children: ['node-2'],
            },
            'node-2': {
              id: 'node-2',
              message: {
                id: 'msg-2',
                author: { role: 'user' },
                create_time: 1705316401.0,
                content: { content_type: 'text', parts: ['User message'] },
              },
              parent: 'node-1',
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
    })

    it('skips tool messages', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'tool' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: ['Tool output'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)
      expect(result.messages).toHaveLength(0)
    })

    it('handles multi-part messages', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: {
                  content_type: 'text',
                  parts: ['Part 1', 'Part 2', 'Part 3'],
                },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages[0].text).toBe('Part 1\nPart 2\nPart 3')
    })

    it('skips empty messages', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: [''] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)
      expect(result.messages).toHaveLength(0)
    })

    it('handles messages without timestamp with warning', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: null,
                content: { content_type: 'text', parts: ['No timestamp'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages).toHaveLength(0)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('without timestamp')
    })

    it('sorts messages by timestamp', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316402.0, // Later
                content: { content_type: 'text', parts: ['Second'] },
              },
              parent: null,
              children: [],
            },
            'node-2': {
              id: 'node-2',
              message: {
                id: 'msg-2',
                author: { role: 'user' },
                create_time: 1705316400.0, // Earlier
                content: { content_type: 'text', parts: ['First'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages[0].text).toBe('First')
      expect(result.messages[1].text).toBe('Second')
    })

    it('handles multiple conversations', () => {
      const content = JSON.stringify([
        {
          title: 'Conversation 1',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: ['Conv 1 message'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-1',
        },
        {
          title: 'Conversation 2',
          create_time: 1705316600,
          update_time: 1705316700,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316600.0,
                content: { content_type: 'text', parts: ['Conv 2 message'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-2',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].sourceConversationId).toBe('conv-1')
      expect(result.messages[1].sourceConversationId).toBe('conv-2')
    })

    it('handles nodes without message', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: null, // Root node often has no message
              parent: null,
              children: ['node-2'],
            },
            'node-2': {
              id: 'node-2',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.0,
                content: { content_type: 'text', parts: ['Hello'] },
              },
              parent: 'node-1',
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].text).toBe('Hello')
    })

    it('converts timestamps to UTC Date objects', () => {
      const content = JSON.stringify([
        {
          title: 'Test',
          create_time: 1705316400,
          update_time: 1705316500,
          mapping: {
            'node-1': {
              id: 'node-1',
              message: {
                id: 'msg-1',
                author: { role: 'user' },
                create_time: 1705316400.123, // Unix timestamp with milliseconds
                content: { content_type: 'text', parts: ['Hello'] },
              },
              parent: null,
              children: [],
            },
          },
          conversation_id: 'conv-123',
        },
      ])

      const result = chatgptParser.parse(content)
      const timestamp = result.messages[0].timestampUtc

      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp.toISOString()).toBe('2024-01-15T11:00:00.123Z')
    })
  })
})
