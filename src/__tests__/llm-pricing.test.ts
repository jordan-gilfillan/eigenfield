import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getRate,
  estimateCostUsd,
  buildPricingSnapshot,
  estimateCostFromSnapshot,
  inferProvider,
} from '../lib/llm/pricing'
import { UnknownModelPricingError } from '../lib/llm/errors'

describe('pricing module', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.LLM_PROVIDER_DEFAULT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getRate', () => {
    it('returns rate for known OpenAI model (gpt-4o)', () => {
      const rate = getRate('openai', 'gpt-4o')
      expect(rate.inputPer1MUsd).toBe(2.5)
      expect(rate.outputPer1MUsd).toBe(10.0)
      expect(rate.cachedInputPer1MUsd).toBe(1.25)
    })

    it('returns rate for known OpenAI model (gpt-4o-mini)', () => {
      const rate = getRate('openai', 'gpt-4o-mini')
      expect(rate.inputPer1MUsd).toBe(0.15)
      expect(rate.outputPer1MUsd).toBe(0.6)
    })

    it('returns rate for known Anthropic model (claude-sonnet-4-5)', () => {
      const rate = getRate('anthropic', 'claude-sonnet-4-5')
      expect(rate.inputPer1MUsd).toBe(3.0)
      expect(rate.outputPer1MUsd).toBe(15.0)
      expect(rate.cachedInputPer1MUsd).toBe(0.3)
    })

    it('returns rate for known Anthropic model (claude-3-5-haiku)', () => {
      const rate = getRate('anthropic', 'claude-3-5-haiku')
      expect(rate.inputPer1MUsd).toBe(0.8)
      expect(rate.outputPer1MUsd).toBe(4.0)
    })

    it('returns zero rates for stub models', () => {
      const rate = getRate('openai', 'stub_summarizer_v1')
      expect(rate.inputPer1MUsd).toBe(0)
      expect(rate.outputPer1MUsd).toBe(0)
    })

    it('returns zero rates when provider is stub', () => {
      const rate = getRate('stub', 'any-model')
      expect(rate.inputPer1MUsd).toBe(0)
      expect(rate.outputPer1MUsd).toBe(0)
    })

    it('throws UnknownModelPricingError for unknown model', () => {
      expect(() => getRate('openai', 'nonexistent-model')).toThrow(
        UnknownModelPricingError
      )
    })

    it('throws UnknownModelPricingError for unknown provider', () => {
      expect(() => getRate('unknown-provider', 'gpt-4o')).toThrow(
        UnknownModelPricingError
      )
    })

    it('UnknownModelPricingError has correct code and details', () => {
      try {
        getRate('openai', 'nonexistent-model')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(UnknownModelPricingError)
        const e = err as UnknownModelPricingError
        expect(e.code).toBe('UNKNOWN_MODEL_PRICING')
        expect(e.details).toEqual({ provider: 'openai', model: 'nonexistent-model' })
      }
    })
  })

  describe('estimateCostUsd', () => {
    it('computes cost for gpt-4o correctly', () => {
      const cost = estimateCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
      })
      // 1M * $2.5/1M + 1M * $10/1M = $12.50
      expect(cost).toBeCloseTo(12.5, 6)
    })

    it('computes cost for small token counts', () => {
      const cost = estimateCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        tokensIn: 1000,
        tokensOut: 500,
      })
      // 1000 * 2.5/1M + 500 * 10/1M = 0.0025 + 0.005 = 0.0075
      expect(cost).toBeCloseTo(0.0075, 6)
    })

    it('includes cached input tokens in cost', () => {
      const withCached = estimateCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        tokensIn: 1000,
        tokensOut: 500,
        cachedInTokens: 2000,
      })
      const withoutCached = estimateCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        tokensIn: 1000,
        tokensOut: 500,
      })
      // cached: 2000 * 1.25/1M = 0.0025
      expect(withCached).toBeCloseTo(withoutCached + 0.0025, 6)
    })

    it('returns 0 for stub models', () => {
      const cost = estimateCostUsd({
        provider: 'openai',
        model: 'stub_summarizer_v1',
        tokensIn: 10000,
        tokensOut: 5000,
      })
      expect(cost).toBe(0)
    })

    it('returns 0 for zero tokens', () => {
      const cost = estimateCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        tokensIn: 0,
        tokensOut: 0,
      })
      expect(cost).toBe(0)
    })

    it('throws for unknown model', () => {
      expect(() =>
        estimateCostUsd({
          provider: 'openai',
          model: 'nonexistent',
          tokensIn: 100,
          tokensOut: 50,
        })
      ).toThrow(UnknownModelPricingError)
    })

    it('computes cost for Anthropic model correctly', () => {
      const cost = estimateCostUsd({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
      })
      // 1M * $3/1M + 1M * $15/1M = $18
      expect(cost).toBeCloseTo(18.0, 6)
    })
  })

  describe('buildPricingSnapshot', () => {
    it('builds snapshot for known model', () => {
      const snapshot = buildPricingSnapshot('openai', 'gpt-4o')
      expect(snapshot.provider).toBe('openai')
      expect(snapshot.model).toBe('gpt-4o')
      expect(snapshot.inputPer1MUsd).toBe(2.5)
      expect(snapshot.outputPer1MUsd).toBe(10.0)
      expect(snapshot.cachedInputPer1MUsd).toBe(1.25)
      expect(snapshot.capturedAt).toBeDefined()
      expect(new Date(snapshot.capturedAt).getTime()).not.toBeNaN()
    })

    it('builds snapshot for stub model with zero rates', () => {
      const snapshot = buildPricingSnapshot('openai', 'stub_summarizer_v1')
      expect(snapshot.inputPer1MUsd).toBe(0)
      expect(snapshot.outputPer1MUsd).toBe(0)
      expect(snapshot.cachedInputPer1MUsd).toBeUndefined()
    })

    it('throws for unknown model', () => {
      expect(() => buildPricingSnapshot('openai', 'nonexistent')).toThrow(
        UnknownModelPricingError
      )
    })

    it('capturedAt is a valid ISO timestamp', () => {
      const snapshot = buildPricingSnapshot('anthropic', 'claude-3-5-sonnet')
      const parsed = new Date(snapshot.capturedAt)
      expect(parsed.toISOString()).toBe(snapshot.capturedAt)
    })
  })

  describe('estimateCostFromSnapshot', () => {
    it('computes cost from a snapshot', () => {
      const snapshot = { inputPer1MUsd: 2.5, outputPer1MUsd: 10.0 }
      const cost = estimateCostFromSnapshot(snapshot, 1000, 500)
      // 1000 * 2.5/1M + 500 * 10/1M = 0.0025 + 0.005 = 0.0075
      expect(cost).toBeCloseTo(0.0075, 6)
    })

    it('includes cached tokens', () => {
      const snapshot = { inputPer1MUsd: 2.5, outputPer1MUsd: 10.0, cachedInputPer1MUsd: 1.25 }
      const cost = estimateCostFromSnapshot(snapshot, 1000, 500, 2000)
      expect(cost).toBeCloseTo(0.0075 + 0.0025, 6)
    })

    it('returns 0 for zero-rate snapshot', () => {
      const snapshot = { inputPer1MUsd: 0, outputPer1MUsd: 0 }
      const cost = estimateCostFromSnapshot(snapshot, 10000, 5000)
      expect(cost).toBe(0)
    })
  })

  describe('inferProvider', () => {
    it('infers anthropic from claude model names', () => {
      expect(inferProvider('claude-sonnet-4-5')).toBe('anthropic')
      expect(inferProvider('claude-3-5-haiku')).toBe('anthropic')
    })

    it('infers openai from gpt model names', () => {
      expect(inferProvider('gpt-4o')).toBe('openai')
      expect(inferProvider('gpt-4o-mini')).toBe('openai')
      expect(inferProvider('gpt-4.1')).toBe('openai')
    })

    it('infers openai from o1/o3 model names', () => {
      expect(inferProvider('o1-preview')).toBe('openai')
      expect(inferProvider('o3-mini')).toBe('openai')
    })

    it('falls back to env default', () => {
      process.env.LLM_PROVIDER_DEFAULT = 'anthropic'
      expect(inferProvider('unknown-model')).toBe('anthropic')
    })

    it('falls back to openai when no env default', () => {
      delete process.env.LLM_PROVIDER_DEFAULT
      expect(inferProvider('unknown-model')).toBe('openai')
    })

    it('is case-insensitive', () => {
      expect(inferProvider('Claude-Sonnet-4-5')).toBe('anthropic')
      expect(inferProvider('GPT-4o')).toBe('openai')
    })
  })
})

describe('UnknownModelPricingError', () => {
  it('has code UNKNOWN_MODEL_PRICING', () => {
    const err = new UnknownModelPricingError('openai', 'fake-model')
    expect(err.code).toBe('UNKNOWN_MODEL_PRICING')
  })

  it('includes provider and model in details', () => {
    const err = new UnknownModelPricingError('anthropic', 'claude-99')
    expect(err.details).toEqual({ provider: 'anthropic', model: 'claude-99' })
  })

  it('is an instance of Error and LlmError', async () => {
    const { LlmError } = await import('../lib/llm/errors')
    const err = new UnknownModelPricingError('openai', 'x')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(LlmError)
  })

  it('has descriptive message', () => {
    const err = new UnknownModelPricingError('openai', 'fake')
    expect(err.message).toContain('openai')
    expect(err.message).toContain('fake')
  })
})
