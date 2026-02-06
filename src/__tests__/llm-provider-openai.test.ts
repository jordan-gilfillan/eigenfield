import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LlmRequest } from '../lib/llm/types'
import { LlmProviderError } from '../lib/llm/errors'

// Mock the openai module before importing the provider
vi.mock('openai', () => {
  const MockOpenAI = vi.fn()
  return { default: MockOpenAI }
})

import OpenAI from 'openai'
import { callOpenAi } from '../lib/llm/providers/openai'

const MockOpenAI = vi.mocked(OpenAI)

function makeRequest(overrides?: Partial<LlmRequest>): LlmRequest {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
    ...overrides,
  }
}

describe('callOpenAi', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreate = vi.fn()
    MockOpenAI.mockImplementation(() => ({
      responses: { create: mockCreate },
    }) as unknown as OpenAI)
  })

  it('extracts text from output_text', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'Hello from GPT',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })

    const result = await callOpenAi(makeRequest(), 'sk-test')
    expect(result.text).toBe('Hello from GPT')
  })

  it('extracts token counts from usage', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'Response',
      usage: { input_tokens: 42, output_tokens: 18, total_tokens: 60 },
    })

    const result = await callOpenAi(makeRequest(), 'sk-test')
    expect(result.tokensIn).toBe(42)
    expect(result.tokensOut).toBe(18)
  })

  it('returns raw response object', async () => {
    const rawResponse = {
      id: 'resp_123',
      output_text: 'Text',
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    }
    mockCreate.mockResolvedValue(rawResponse)

    const result = await callOpenAi(makeRequest(), 'sk-test')
    expect(result.raw).toBe(rawResponse)
  })

  it('handles missing usage gracefully (defaults to 0)', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'No usage info',
      usage: undefined,
    })

    const result = await callOpenAi(makeRequest(), 'sk-test')
    expect(result.tokensIn).toBe(0)
    expect(result.tokensOut).toBe(0)
  })

  it('handles null output_text gracefully', async () => {
    mockCreate.mockResolvedValue({
      output_text: null,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    })

    const result = await callOpenAi(makeRequest(), 'sk-test')
    expect(result.text).toBe('')
  })

  it('passes model to the API', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(makeRequest({ model: 'gpt-4o-mini' }), 'sk-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' })
    )
  })

  it('passes system as instructions', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(makeRequest({ system: 'You are a classifier.' }), 'sk-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: 'You are a classifier.' })
    )
  })

  it('maps system role to developer in input messages', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(
      makeRequest({
        messages: [
          { role: 'system', content: 'System msg' },
          { role: 'user', content: 'User msg' },
        ],
      }),
      'sk-test'
    )

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.input[0].role).toBe('developer')
    expect(callArgs.input[1].role).toBe('user')
  })

  it('passes temperature when provided', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(makeRequest({ temperature: 0 }), 'sk-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 })
    )
  })

  it('passes maxTokens as max_output_tokens', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(makeRequest({ maxTokens: 512 }), 'sk-test')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_output_tokens: 512 })
    )
  })

  it('constructs client with apiKey', async () => {
    mockCreate.mockResolvedValue({
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

    await callOpenAi(makeRequest(), 'sk-my-key')

    expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-my-key' })
  })

  describe('error handling', () => {
    it('wraps generic errors into LlmProviderError with details', async () => {
      mockCreate.mockRejectedValue(new Error('network timeout'))

      try {
        await callOpenAi(makeRequest(), 'sk-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        const e = err as LlmProviderError
        expect(e.code).toBe('LLM_PROVIDER_ERROR')
        expect(e.message).toContain('network timeout')
        expect(e.details?.provider).toBe('openai')
      }
    })

    it('wraps non-Error throws into LlmProviderError', async () => {
      mockCreate.mockRejectedValue('string error')

      try {
        await callOpenAi(makeRequest(), 'sk-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        const e = err as LlmProviderError
        expect(e.code).toBe('LLM_PROVIDER_ERROR')
        expect(e.message).toContain('string error')
      }
    })

    it('preserves error message content', async () => {
      mockCreate.mockRejectedValue(new Error('Request failed with status 500'))

      try {
        await callOpenAi(makeRequest(), 'sk-test')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LlmProviderError)
        expect((err as LlmProviderError).message).toContain('500')
      }
    })
  })
})
