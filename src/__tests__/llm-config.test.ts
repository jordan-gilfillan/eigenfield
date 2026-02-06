import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getLlmMode, getDefaultProvider, getApiKey, getMinDelayMs, getSpendCaps } from '../lib/llm/config'
import { MissingApiKeyError } from '../lib/llm/errors'

describe('LLM config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear all LLM env vars before each test
    delete process.env.LLM_MODE
    delete process.env.LLM_PROVIDER_DEFAULT
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.LLM_MIN_DELAY_MS
    delete process.env.LLM_MAX_USD_PER_RUN
    delete process.env.LLM_MAX_USD_PER_DAY
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('getLlmMode', () => {
    it('defaults to dry_run when LLM_MODE is unset', () => {
      expect(getLlmMode()).toBe('dry_run')
    })

    it('returns dry_run when LLM_MODE is empty string', () => {
      process.env.LLM_MODE = ''
      expect(getLlmMode()).toBe('dry_run')
    })

    it('returns real when LLM_MODE is "real"', () => {
      process.env.LLM_MODE = 'real'
      expect(getLlmMode()).toBe('real')
    })

    it('returns real when LLM_MODE is "REAL" (case-insensitive)', () => {
      process.env.LLM_MODE = 'REAL'
      expect(getLlmMode()).toBe('real')
    })

    it('returns dry_run when LLM_MODE is "dry_run"', () => {
      process.env.LLM_MODE = 'dry_run'
      expect(getLlmMode()).toBe('dry_run')
    })

    it('returns dry_run for unrecognized values', () => {
      process.env.LLM_MODE = 'something_else'
      expect(getLlmMode()).toBe('dry_run')
    })

    it('trims whitespace', () => {
      process.env.LLM_MODE = '  real  '
      expect(getLlmMode()).toBe('real')
    })
  })

  describe('getDefaultProvider', () => {
    it('returns undefined when unset', () => {
      expect(getDefaultProvider()).toBeUndefined()
    })

    it('returns openai when set', () => {
      process.env.LLM_PROVIDER_DEFAULT = 'openai'
      expect(getDefaultProvider()).toBe('openai')
    })

    it('returns anthropic when set', () => {
      process.env.LLM_PROVIDER_DEFAULT = 'anthropic'
      expect(getDefaultProvider()).toBe('anthropic')
    })

    it('is case-insensitive', () => {
      process.env.LLM_PROVIDER_DEFAULT = 'OPENAI'
      expect(getDefaultProvider()).toBe('openai')
    })

    it('returns undefined for invalid values', () => {
      process.env.LLM_PROVIDER_DEFAULT = 'google'
      expect(getDefaultProvider()).toBeUndefined()
    })
  })

  describe('getApiKey', () => {
    it('returns OPENAI_API_KEY for openai provider', () => {
      process.env.OPENAI_API_KEY = 'sk-test-123'
      expect(getApiKey('openai')).toBe('sk-test-123')
    })

    it('returns ANTHROPIC_API_KEY for anthropic provider', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-456'
      expect(getApiKey('anthropic')).toBe('sk-ant-test-456')
    })

    it('throws MissingApiKeyError when key is not set', () => {
      expect(() => getApiKey('openai')).toThrow(MissingApiKeyError)
    })

    it('MissingApiKeyError has correct code and provider details', () => {
      try {
        getApiKey('openai')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(MissingApiKeyError)
        const e = err as MissingApiKeyError
        expect(e.code).toBe('MISSING_API_KEY')
        expect(e.details).toEqual({ provider: 'openai' })
      }
    })

    it('throws when key is empty string', () => {
      process.env.OPENAI_API_KEY = ''
      expect(() => getApiKey('openai')).toThrow(MissingApiKeyError)
    })

    it('throws when key is whitespace only', () => {
      process.env.OPENAI_API_KEY = '   '
      expect(() => getApiKey('openai')).toThrow(MissingApiKeyError)
    })

    it('trims whitespace from key', () => {
      process.env.OPENAI_API_KEY = '  sk-test-123  '
      expect(getApiKey('openai')).toBe('sk-test-123')
    })
  })

  describe('getMinDelayMs', () => {
    it('defaults to 250 when unset', () => {
      expect(getMinDelayMs()).toBe(250)
    })

    it('reads from LLM_MIN_DELAY_MS', () => {
      process.env.LLM_MIN_DELAY_MS = '500'
      expect(getMinDelayMs()).toBe(500)
    })

    it('allows 0 (no delay)', () => {
      process.env.LLM_MIN_DELAY_MS = '0'
      expect(getMinDelayMs()).toBe(0)
    })

    it('falls back to 250 for non-numeric values', () => {
      process.env.LLM_MIN_DELAY_MS = 'fast'
      expect(getMinDelayMs()).toBe(250)
    })

    it('falls back to 250 for negative values', () => {
      process.env.LLM_MIN_DELAY_MS = '-10'
      expect(getMinDelayMs()).toBe(250)
    })
  })

  describe('getSpendCaps', () => {
    it('returns empty object when no caps set', () => {
      expect(getSpendCaps()).toEqual({})
    })

    it('reads maxUsdPerRun', () => {
      process.env.LLM_MAX_USD_PER_RUN = '5.00'
      expect(getSpendCaps()).toEqual({ maxUsdPerRun: 5.0 })
    })

    it('reads maxUsdPerDay', () => {
      process.env.LLM_MAX_USD_PER_DAY = '10.50'
      expect(getSpendCaps()).toEqual({ maxUsdPerDay: 10.5 })
    })

    it('reads both caps together', () => {
      process.env.LLM_MAX_USD_PER_RUN = '5.00'
      process.env.LLM_MAX_USD_PER_DAY = '10.50'
      expect(getSpendCaps()).toEqual({ maxUsdPerRun: 5.0, maxUsdPerDay: 10.5 })
    })

    it('ignores invalid values', () => {
      process.env.LLM_MAX_USD_PER_RUN = 'lots'
      expect(getSpendCaps()).toEqual({})
    })

    it('ignores zero or negative values', () => {
      process.env.LLM_MAX_USD_PER_RUN = '0'
      process.env.LLM_MAX_USD_PER_DAY = '-1'
      expect(getSpendCaps()).toEqual({})
    })
  })
})
