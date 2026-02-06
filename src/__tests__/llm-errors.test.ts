import { describe, it, expect } from 'vitest'
import {
  LlmError,
  MissingApiKeyError,
  ProviderNotImplementedError,
  BudgetExceededError,
  LlmBadOutputError,
} from '../lib/llm/errors'

describe('LLM error classes', () => {
  describe('LlmError', () => {
    it('has code and message', () => {
      const err = new LlmError('TEST_CODE', 'test message')
      expect(err.code).toBe('TEST_CODE')
      expect(err.message).toBe('test message')
      expect(err.details).toBeUndefined()
    })

    it('accepts optional details', () => {
      const err = new LlmError('TEST_CODE', 'test', { foo: 'bar' })
      expect(err.details).toEqual({ foo: 'bar' })
    })

    it('is an instance of Error', () => {
      const err = new LlmError('TEST_CODE', 'test')
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe('MissingApiKeyError', () => {
    it('has code MISSING_API_KEY', () => {
      const err = new MissingApiKeyError('openai')
      expect(err.code).toBe('MISSING_API_KEY')
    })

    it('includes provider in details', () => {
      const err = new MissingApiKeyError('anthropic')
      expect(err.details).toEqual({ provider: 'anthropic' })
    })

    it('is an instance of LlmError', () => {
      const err = new MissingApiKeyError('openai')
      expect(err).toBeInstanceOf(LlmError)
    })

    it('has descriptive message', () => {
      const err = new MissingApiKeyError('openai')
      expect(err.message).toContain('openai')
    })
  })

  describe('ProviderNotImplementedError', () => {
    it('has code PROVIDER_NOT_IMPLEMENTED', () => {
      const err = new ProviderNotImplementedError('openai')
      expect(err.code).toBe('PROVIDER_NOT_IMPLEMENTED')
    })

    it('includes provider in details', () => {
      const err = new ProviderNotImplementedError('anthropic')
      expect(err.details).toEqual({ provider: 'anthropic' })
    })

    it('is an instance of LlmError', () => {
      const err = new ProviderNotImplementedError('openai')
      expect(err).toBeInstanceOf(LlmError)
    })
  })

  describe('BudgetExceededError', () => {
    it('has code BUDGET_EXCEEDED', () => {
      const err = new BudgetExceededError(0.05, 4.96, 5.0, 'per_run')
      expect(err.code).toBe('BUDGET_EXCEEDED')
    })

    it('includes cost details', () => {
      const err = new BudgetExceededError(0.05, 4.96, 5.0, 'per_run')
      expect(err.details).toEqual({
        nextCostUsd: 0.05,
        spentUsdSoFar: 4.96,
        limitUsd: 5.0,
        limitType: 'per_run',
      })
    })

    it('has descriptive message with formatted amounts', () => {
      const err = new BudgetExceededError(0.05, 4.96, 5.0, 'per_run')
      expect(err.message).toContain('$0.0500')
      expect(err.message).toContain('$4.9600')
      expect(err.message).toContain('$5.0000')
      expect(err.message).toContain('per_run')
    })

    it('is an instance of LlmError', () => {
      const err = new BudgetExceededError(0.05, 4.96, 5.0, 'per_day')
      expect(err).toBeInstanceOf(LlmError)
    })
  })

  describe('LlmBadOutputError', () => {
    it('has code LLM_BAD_OUTPUT', () => {
      const err = new LlmBadOutputError('bad output')
      expect(err.code).toBe('LLM_BAD_OUTPUT')
    })

    it('accepts optional details', () => {
      const err = new LlmBadOutputError('bad output', { rawOutput: 'garbage' })
      expect(err.details).toEqual({ rawOutput: 'garbage' })
    })

    it('is an instance of LlmError', () => {
      const err = new LlmBadOutputError('bad output')
      expect(err).toBeInstanceOf(LlmError)
    })

    it('has descriptive message', () => {
      const err = new LlmBadOutputError('LLM output is not valid JSON')
      expect(err.message).toContain('not valid JSON')
    })
  })
})
