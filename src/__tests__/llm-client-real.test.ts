/**
 * Tests for callLlm() in real mode with mocked provider modules.
 *
 * These tests verify the full call path: API key validation → provider dispatch
 * → token extraction → cost computation, without making network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LlmRequest } from '../lib/llm/types'
import { MissingApiKeyError, LlmProviderError, UnknownModelPricingError } from '../lib/llm/errors'

// Mock provider modules to prevent network calls
vi.mock('../lib/llm/providers/openai', () => ({
  callOpenAi: vi.fn(),
}))
vi.mock('../lib/llm/providers/anthropic', () => ({
  callAnthropic: vi.fn(),
}))

import { callLlm } from '../lib/llm/client'
import { callOpenAi } from '../lib/llm/providers/openai'
import { callAnthropic } from '../lib/llm/providers/anthropic'

const mockedCallOpenAi = vi.mocked(callOpenAi)
const mockedCallAnthropic = vi.mocked(callAnthropic)

describe('callLlm real mode', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LLM_MODE = 'real'
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('OpenAI routing', () => {
    const openaiReq: LlmRequest = {
      provider: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Classify this text' }],
      system: 'You are a classifier.',
      temperature: 0,
      metadata: { stage: 'classify', atomStableId: 'test-1' },
    }

    it('throws MissingApiKeyError without OPENAI_API_KEY', async () => {
      await expect(callLlm(openaiReq)).rejects.toThrow(MissingApiKeyError)
    })

    it('calls callOpenAi with correct args when key is set', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      mockedCallOpenAi.mockResolvedValue({
        text: '{"category":"WORK","confidence":0.9}',
        tokensIn: 100,
        tokensOut: 20,
        raw: { id: 'resp_1' },
      })

      const resp = await callLlm(openaiReq)

      expect(mockedCallOpenAi).toHaveBeenCalledWith(openaiReq, 'sk-test-key')
      expect(mockedCallAnthropic).not.toHaveBeenCalled()
      expect(resp.text).toBe('{"category":"WORK","confidence":0.9}')
      expect(resp.dryRun).toBe(false)
    })

    it('returns correct token counts from provider', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      mockedCallOpenAi.mockResolvedValue({
        text: 'response',
        tokensIn: 150,
        tokensOut: 30,
        raw: {},
      })

      const resp = await callLlm(openaiReq)
      expect(resp.tokensIn).toBe(150)
      expect(resp.tokensOut).toBe(30)
    })

    it('computes costUsd from pricing book', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      mockedCallOpenAi.mockResolvedValue({
        text: 'response',
        tokensIn: 1_000_000, // 1M tokens at $2.50/M = $2.50
        tokensOut: 1_000_000, // 1M tokens at $10/M = $10
        raw: {},
      })

      const resp = await callLlm(openaiReq)
      // gpt-4o: input $2.5/M, output $10/M
      expect(resp.costUsd).toBeCloseTo(12.5, 4)
    })

    it('throws UnknownModelPricingError for unknown model', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      const unknownModelReq: LlmRequest = {
        ...openaiReq,
        model: 'gpt-99-turbo',
      }
      mockedCallOpenAi.mockResolvedValue({
        text: 'response',
        tokensIn: 100,
        tokensOut: 20,
        raw: {},
      })

      await expect(callLlm(unknownModelReq)).rejects.toThrow(UnknownModelPricingError)
    })

    it('includes raw in response', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      const rawData = { id: 'resp_abc', model: 'gpt-4o' }
      mockedCallOpenAi.mockResolvedValue({
        text: 'response',
        tokensIn: 10,
        tokensOut: 5,
        raw: rawData,
      })

      const resp = await callLlm(openaiReq)
      expect(resp.raw).toBe(rawData)
    })

    it('propagates LlmProviderError from provider', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      mockedCallOpenAi.mockRejectedValue(
        new LlmProviderError('openai', 'rate limit exceeded', { status: 429 })
      )

      await expect(callLlm(openaiReq)).rejects.toThrow(LlmProviderError)
    })
  })

  describe('Anthropic routing', () => {
    const anthropicReq: LlmRequest = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'Classify this text' }],
      system: 'You are a classifier.',
      temperature: 0,
      metadata: { stage: 'classify', atomStableId: 'test-2' },
    }

    it('throws MissingApiKeyError without ANTHROPIC_API_KEY', async () => {
      await expect(callLlm(anthropicReq)).rejects.toThrow(MissingApiKeyError)
    })

    it('calls callAnthropic with correct args when key is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      mockedCallAnthropic.mockResolvedValue({
        text: '{"category":"LEARNING","confidence":0.85}',
        tokensIn: 80,
        tokensOut: 15,
        raw: { id: 'msg_1' },
      })

      const resp = await callLlm(anthropicReq)

      expect(mockedCallAnthropic).toHaveBeenCalledWith(anthropicReq, 'sk-ant-test-key')
      expect(mockedCallOpenAi).not.toHaveBeenCalled()
      expect(resp.text).toBe('{"category":"LEARNING","confidence":0.85}')
      expect(resp.dryRun).toBe(false)
    })

    it('computes costUsd from pricing book for anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      mockedCallAnthropic.mockResolvedValue({
        text: 'response',
        tokensIn: 1_000_000, // 1M tokens at $3/M = $3
        tokensOut: 1_000_000, // 1M tokens at $15/M = $15
        raw: {},
      })

      const resp = await callLlm(anthropicReq)
      // claude-sonnet-4-5: input $3/M, output $15/M
      expect(resp.costUsd).toBeCloseTo(18.0, 4)
    })

    it('propagates LlmProviderError from provider', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      mockedCallAnthropic.mockRejectedValue(
        new LlmProviderError('anthropic', 'overloaded', { status: 529 })
      )

      await expect(callLlm(anthropicReq)).rejects.toThrow(LlmProviderError)
    })
  })

  describe('classify integration (real mode, mocked provider)', () => {
    it('returns parseable classify JSON from OpenAI provider', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      mockedCallOpenAi.mockResolvedValue({
        text: '{"category":"WORK","confidence":0.92}',
        tokensIn: 200,
        tokensOut: 25,
        raw: {},
      })

      const resp = await callLlm({
        provider: 'openai',
        model: 'gpt-4o',
        system: 'Classify the following message.',
        messages: [{ role: 'user', content: 'Meeting with team at 3pm' }],
        temperature: 0,
        metadata: { stage: 'classify', atomStableId: 'atom-123' },
      })

      expect(resp.dryRun).toBe(false)
      const parsed = JSON.parse(resp.text)
      expect(parsed.category).toBe('WORK')
      expect(parsed.confidence).toBe(0.92)
      expect(resp.tokensIn).toBe(200)
      expect(resp.tokensOut).toBe(25)
      expect(resp.costUsd).toBeGreaterThan(0)
    })

    it('returns parseable classify JSON from Anthropic provider', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      mockedCallAnthropic.mockResolvedValue({
        text: '{"category":"PERSONAL","confidence":0.75}',
        tokensIn: 180,
        tokensOut: 22,
        raw: {},
      })

      const resp = await callLlm({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        system: 'Classify the following message.',
        messages: [{ role: 'user', content: 'Called mom about weekend plans' }],
        temperature: 0,
        metadata: { stage: 'classify', atomStableId: 'atom-456' },
      })

      expect(resp.dryRun).toBe(false)
      const parsed = JSON.parse(resp.text)
      expect(parsed.category).toBe('PERSONAL')
      expect(parsed.confidence).toBe(0.75)
      expect(resp.costUsd).toBeGreaterThan(0)
    })
  })

  describe('dry_run mode is unaffected', () => {
    it('still returns dry-run response when LLM_MODE is not set', async () => {
      delete process.env.LLM_MODE
      const resp = await callLlm({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(resp.dryRun).toBe(true)
      expect(mockedCallOpenAi).not.toHaveBeenCalled()
      expect(mockedCallAnthropic).not.toHaveBeenCalled()
    })

    it('still returns classify dry-run response', async () => {
      delete process.env.LLM_MODE
      const resp = await callLlm({
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        metadata: { stage: 'classify', atomStableId: 'dry-test' },
      })

      expect(resp.dryRun).toBe(true)
      const parsed = JSON.parse(resp.text)
      expect(parsed).toHaveProperty('category')
      expect(parsed).toHaveProperty('confidence', 0.7)
    })
  })
})
