import { describe, it, expect } from 'vitest'
import {
  autoDetectAndParse,
  parseExport,
  getParser,
  UnsupportedFormatError,
  AmbiguousFormatError,
} from '../../lib/parsers'
import { chatgptParser } from '../../lib/parsers/chatgpt'
import { claudeParser } from '../../lib/parsers/claude'
import { grokParser } from '../../lib/parsers/grok'

// =============================================================================
// Fixture helpers
// =============================================================================

function buildChatGPTExport(): string {
  return JSON.stringify([
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
            create_time: 1705316400.123,
            content: { content_type: 'text', parts: ['Hello from ChatGPT'] },
          },
          parent: null,
          children: [],
        },
      },
      conversation_id: 'conv-chatgpt-1',
    },
  ])
}

function buildClaudeExport(): string {
  return JSON.stringify([
    {
      uuid: 'conv-claude-1',
      name: 'Claude Conversation',
      created_at: '2024-01-15T10:00:00.000000+00:00',
      updated_at: '2024-01-15T11:00:00.000000+00:00',
      chat_messages: [
        {
          uuid: 'msg-claude-1',
          text: 'Hello from Claude',
          sender: 'human',
          created_at: '2024-01-15T10:30:00.000000+00:00',
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
          id: 'conv-grok-1',
          title: 'Grok Conversation',
          create_time: '2024-01-15T10:00:00.000000Z',
        },
        responses: [
          {
            response: {
              _id: 'msg-grok-1',
              conversation_id: 'conv-grok-1',
              message: 'Hello from Grok',
              sender: 'human',
              create_time: { $date: { $numberLong: '1705312200000' } },
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
// Parser.id tests
// =============================================================================

describe('Parser.id', () => {
  it('chatgptParser.id is "chatgpt"', () => {
    expect(chatgptParser.id).toBe('chatgpt')
  })

  it('claudeParser.id is "claude"', () => {
    expect(claudeParser.id).toBe('claude')
  })

  it('grokParser.id is "grok"', () => {
    expect(grokParser.id).toBe('grok')
  })
})

// =============================================================================
// getParser tests
// =============================================================================

describe('getParser', () => {
  it('returns chatgptParser for "chatgpt"', () => {
    expect(getParser('chatgpt')).toBe(chatgptParser)
  })

  it('returns claudeParser for "claude"', () => {
    expect(getParser('claude')).toBe(claudeParser)
  })

  it('returns grokParser for "grok"', () => {
    expect(getParser('grok')).toBe(grokParser)
  })

  it('throws for "mixed"', () => {
    expect(() => getParser('mixed')).toThrow('is not implemented')
  })
})

// =============================================================================
// autoDetectAndParse — single match (happy path)
// =============================================================================

describe('autoDetectAndParse', () => {
  describe('single match (happy path)', () => {
    it('detects ChatGPT export', () => {
      const result = autoDetectAndParse(buildChatGPTExport())
      expect(result.source).toBe('chatgpt')
      expect(result.messages.length).toBeGreaterThan(0)
      expect(result.messages[0].text).toBe('Hello from ChatGPT')
    })

    it('detects Claude export', () => {
      const result = autoDetectAndParse(buildClaudeExport())
      expect(result.source).toBe('claude')
      expect(result.messages.length).toBeGreaterThan(0)
      expect(result.messages[0].text).toBe('Hello from Claude')
    })

    it('detects Grok export', () => {
      const result = autoDetectAndParse(buildGrokExport())
      expect(result.source).toBe('grok')
      expect(result.messages.length).toBeGreaterThan(0)
      expect(result.messages[0].text).toBe('Hello from Grok')
    })
  })

  // ===========================================================================
  // Zero matches → UnsupportedFormatError
  // ===========================================================================

  describe('zero matches → UnsupportedFormatError', () => {
    it('throws for unrecognized JSON object', () => {
      const content = JSON.stringify({ unknown: 'format' })
      expect(() => autoDetectAndParse(content)).toThrow(UnsupportedFormatError)
    })

    it('throws for plain string', () => {
      expect(() => autoDetectAndParse('"hello"')).toThrow(
        UnsupportedFormatError
      )
    })

    it('throws for number', () => {
      expect(() => autoDetectAndParse('42')).toThrow(UnsupportedFormatError)
    })

    it('throws for invalid JSON', () => {
      expect(() => autoDetectAndParse('not json at all')).toThrow(
        UnsupportedFormatError
      )
    })

    it('throws for empty object', () => {
      expect(() => autoDetectAndParse('{}')).toThrow(UnsupportedFormatError)
    })

    it('has correct error code and name', () => {
      try {
        autoDetectAndParse(JSON.stringify({ foo: 'bar' }))
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(UnsupportedFormatError)
        expect((e as UnsupportedFormatError).code).toBe('UNSUPPORTED_FORMAT')
        expect((e as UnsupportedFormatError).name).toBe(
          'UnsupportedFormatError'
        )
      }
    })

    it('throws for array without ChatGPT-specific fields (not Claude either)', () => {
      // Array of objects but no 'mapping'/'conversation_id' (ChatGPT) or 'uuid'/'chat_messages' (Claude)
      const content = JSON.stringify([{ title: 'Some notes', items: [] }])
      expect(() => autoDetectAndParse(content)).toThrow(UnsupportedFormatError)
    })
  })

  // ===========================================================================
  // Multiple matches → AmbiguousFormatError
  // ===========================================================================

  describe('multiple matches → AmbiguousFormatError', () => {
    it('throws AmbiguousFormatError for synthetic data matching both ChatGPT and Claude', () => {
      // Craft JSON that satisfies both canParse checks:
      // - Array (ChatGPT checks for array)
      // - First element has 'mapping' + 'conversation_id' (ChatGPT)
      // - First element also has 'uuid' + 'chat_messages' (Claude)
      const ambiguous = JSON.stringify([
        {
          // ChatGPT markers
          mapping: { 'node-1': { id: 'node-1', message: null, parent: null, children: [] } },
          conversation_id: 'conv-1',
          // Claude markers
          uuid: 'conv-1',
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Ambiguous message',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.000000+00:00',
            },
          ],
          name: 'Test',
          created_at: '2024-01-15T10:00:00.000000+00:00',
          updated_at: '2024-01-15T11:00:00.000000+00:00',
        },
      ])

      // Verify both parsers claim they can parse it
      expect(chatgptParser.canParse(ambiguous)).toBe(true)
      expect(claudeParser.canParse(ambiguous)).toBe(true)

      expect(() => autoDetectAndParse(ambiguous)).toThrow(AmbiguousFormatError)
    })

    it('AmbiguousFormatError contains matched parser ids', () => {
      const ambiguous = JSON.stringify([
        {
          mapping: {},
          conversation_id: 'conv-1',
          uuid: 'conv-1',
          chat_messages: [
            {
              uuid: 'msg-1',
              text: 'Test',
              sender: 'human',
              created_at: '2024-01-15T10:30:00.000000+00:00',
            },
          ],
          name: 'Test',
          created_at: '2024-01-15T10:00:00.000000+00:00',
          updated_at: '2024-01-15T11:00:00.000000+00:00',
        },
      ])

      try {
        autoDetectAndParse(ambiguous)
        expect.fail('Should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(AmbiguousFormatError)
        const err = e as AmbiguousFormatError
        expect(err.code).toBe('AMBIGUOUS_FORMAT')
        expect(err.name).toBe('AmbiguousFormatError')
        expect(err.matched).toContain('chatgpt')
        expect(err.matched).toContain('claude')
        expect(err.matched.length).toBe(2)
      }
    })
  })

  // ===========================================================================
  // No cross-contamination between real formats
  // ===========================================================================

  describe('format discrimination', () => {
    it('ChatGPT export does NOT match Claude parser', () => {
      expect(claudeParser.canParse(buildChatGPTExport())).toBe(false)
    })

    it('ChatGPT export does NOT match Grok parser', () => {
      expect(grokParser.canParse(buildChatGPTExport())).toBe(false)
    })

    it('Claude export does NOT match ChatGPT parser', () => {
      expect(chatgptParser.canParse(buildClaudeExport())).toBe(false)
    })

    it('Claude export does NOT match Grok parser', () => {
      expect(grokParser.canParse(buildClaudeExport())).toBe(false)
    })

    it('Grok export does NOT match ChatGPT parser', () => {
      expect(chatgptParser.canParse(buildGrokExport())).toBe(false)
    })

    it('Grok export does NOT match Claude parser', () => {
      expect(claudeParser.canParse(buildGrokExport())).toBe(false)
    })
  })
})

// =============================================================================
// parseExport — source override vs auto-detect
// =============================================================================

describe('parseExport', () => {
  it('uses specified parser when sourceOverride is provided', () => {
    const result = parseExport(buildChatGPTExport(), 'chatgpt')
    expect(result.source).toBe('chatgpt')
  })

  it('auto-detects when no sourceOverride is provided', () => {
    const result = parseExport(buildClaudeExport())
    expect(result.source).toBe('claude')
  })

  it('auto-detects when sourceOverride is undefined', () => {
    const result = parseExport(buildGrokExport(), undefined)
    expect(result.source).toBe('grok')
  })

  it('throws for unrecognized format without sourceOverride', () => {
    expect(() => parseExport(JSON.stringify({ random: true }))).toThrow(
      UnsupportedFormatError
    )
  })

  it('falls through to auto-detect when sourceOverride is "mixed"', () => {
    // "mixed" is not a real parser — parseExport treats it like no override
    const result = parseExport(buildChatGPTExport(), 'mixed')
    expect(result.source).toBe('chatgpt')
  })
})
