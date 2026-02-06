import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmRequest } from '../lib/llm/types'
import { LlmProviderError } from '../lib/llm/errors'

// Mock the @anthropic-ai/sdk module before importing the provider
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn()
  return { default: MockAnthropic }
})

import Anthropic from '@anthropic-ai/sdk'
import { callAnthropic } from '../lib/llm/providers/anthropic'

const MockAnthropic = vi.mocked(Anthropic)

function makeRequest(overrides?: Partial<LlmRequest>): LlmRequest {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  }
}

describe('callAnthropic', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate = vi.fn()
    MockAnthropic.mockImplementation(() => ({
      messages: { create: mockCreate },
    }) as unknown as Anthropic)
  })

  it('extracts text from content blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from Claude' }],
      usage: { input_tokens: 10, output_tokens: 7 },
    })

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.text).toBe('Hello from Claude')
  })

  it('joins multiple text blocks with newlines', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'First block' },
        { type: 'text', text: 'Second block' },
      ],
      usage: { input_tokens: 10, output_tokens: 7 },
    })

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.text).toBe('First block\nSecond block')
  })

  it('skips non-text content blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'fn', input: {} },
        { type: 'text', text: 'Actual text' },
      ],
      usage: { input_tokens: 10, output_tokens: 7 },
    })

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.text).toBe('Actual text')
  })

  it('extracts token counts from usage', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 42, output_tokens: 18 },
    })

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.tokensIn).toBe(42)
    expect(result.tokensOut).toBe(18)
  })

  it('returns raw response object', async () => {
    const rawResponse = {
      id: 'msg_123',
      content: [{ type: 'text', text: 'Text' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    }
    mockCreate.mockResolvedValue(rawResponse)

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.raw).toBe(rawResponse)
  })

  it('returns empty text when no text blocks', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tool-1', name: 'fn', input: {} }],
      usage: { input_tokens: 5, output_tokens: 3 },
    })

    const result = await callAnthropic(makeRequest(), 'sk-ant-test')
    expect(result.text).toBe('')
  })

  it('passes model to the API', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest({ model: 'claude-3-5-haiku' }), 'sk-ant-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-3-5-haiku' })
    )
  })

  it('passes system prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest({ system: 'You are a classifier.' }), 'sk-ant-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'You are a classifier.' })
    )
  })

  it('filters out system messages from messages array', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(
      makeRequest({
        messages: [
          { role: 'system', content: 'System msg' },
          { role: 'user', content: 'User msg' },
        ],
      }),
      'sk-ant-test'
    )

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages).toHaveLength(1)
    expect(callArgs.messages[0].role).toBe('user')
  })

  it('passes temperature when provided', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest({ temperature: 0 }), 'sk-ant-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 })
    )
  })

  it('passes maxTokens as max_tokens', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest({ maxTokens: 2048 }), 'sk-ant-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 })
    )
  })

  it('defaults max_tokens to 1024', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest(), 'sk-ant-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 1024 })
    )
  })

  it('constructs client with apiKey', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    await callAnthropic(makeRequest(), 'sk-ant-my-key')

    expect(MockAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-ant-my-key' })
  })

  describe('error handling', () => {
    it('wraps generic errors into LlmProviderError with details', async () => {
      mockCreate.mockRejectedValue(new Error('connection refused'))

      try {
        await callAnthropic(makeRequest(), 'sk-ant-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        const e = err as LlmProviderError
        expect(e.code).toBe('LLM_PROVIDER_ERROR')
        expect(e.message).toContain('connection refused')
        expect(e.details?.provider).toBe('anthropic')
      }
    })

    it('wraps non-Error throws into LlmProviderError', async () => {
      mockCreate.mockRejectedValue('string error')

      try {
        await callAnthropic(makeRequest(), 'sk-ant-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        const e = err as LlmProviderError
        expect(e.code).toBe('LLM_PROVIDER_ERROR')
        expect(e.message).toContain('string error')
      }
    })

    it('preserves error message content', async () => {
      mockCreate.mockRejectedValue(new Error('Request failed with status 529'))

      try {
        await callAnthropic(makeRequest(), 'sk-ant-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        expect((err as LlmProviderError).message).toContain('529')
      }
    })
  })
})
