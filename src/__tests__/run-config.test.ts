import { describe, it, expect } from 'vitest'
import { parseRunConfig } from '../lib/types/run-config'

const VALID_CONFIG = {
  promptVersionIds: { summarize: 'pv-sum-001' },
  labelSpec: { model: 'stub_v1', promptVersionId: 'pv-cls-001' },
  filterProfileSnapshot: { name: 'default', mode: 'exclude', categories: ['spam'] },
  timezone: 'America/New_York',
  maxInputTokens: 12000,
}

describe('parseRunConfig', () => {
  it('returns RunConfig for valid input with all required fields', () => {
    const result = parseRunConfig(VALID_CONFIG)
    expect(result.promptVersionIds.summarize).toBe('pv-sum-001')
    expect(result.labelSpec.model).toBe('stub_v1')
    expect(result.labelSpec.promptVersionId).toBe('pv-cls-001')
    expect(result.filterProfileSnapshot.name).toBe('default')
    expect(result.filterProfileSnapshot.mode).toBe('exclude')
    expect(result.filterProfileSnapshot.categories).toEqual(['spam'])
    expect(result.timezone).toBe('America/New_York')
    expect(result.maxInputTokens).toBe(12000)
  })

  it('passes through pricingSnapshot when present', () => {
    const input = {
      ...VALID_CONFIG,
      pricingSnapshot: {
        provider: 'openai',
        model: 'gpt-4o',
        inputPer1MUsd: 5,
        outputPer1MUsd: 15,
        capturedAt: '2025-01-01T00:00:00.000Z',
      },
    }
    const result = parseRunConfig(input)
    expect(result.pricingSnapshot).toBeDefined()
    expect(result.pricingSnapshot!.model).toBe('gpt-4o')
  })

  it('passes through importBatchIds when present', () => {
    const input = { ...VALID_CONFIG, importBatchIds: ['batch-1', 'batch-2'] }
    const result = parseRunConfig(input)
    expect(result.importBatchIds).toEqual(['batch-1', 'batch-2'])
  })

  it('returns RunConfig without optional fields when absent', () => {
    const result = parseRunConfig(VALID_CONFIG)
    expect(result.pricingSnapshot).toBeUndefined()
    expect(result.importBatchIds).toBeUndefined()
  })

  describe('throws on missing required fields', () => {
    it('throws when input is null', () => {
      expect(() => parseRunConfig(null)).toThrow('Invalid RunConfig:')
    })

    it('throws when input is not an object', () => {
      expect(() => parseRunConfig('string')).toThrow('Invalid RunConfig:')
    })

    it('throws when promptVersionIds is missing', () => {
      const { promptVersionIds, ...rest } = VALID_CONFIG
      expect(() => parseRunConfig(rest)).toThrow('Invalid RunConfig: missing or invalid promptVersionIds')
    })

    it('throws when labelSpec is missing', () => {
      const { labelSpec, ...rest } = VALID_CONFIG
      expect(() => parseRunConfig(rest)).toThrow('Invalid RunConfig: missing or invalid labelSpec')
    })

    it('throws when filterProfileSnapshot is missing', () => {
      const { filterProfileSnapshot, ...rest } = VALID_CONFIG
      expect(() => parseRunConfig(rest)).toThrow('Invalid RunConfig: missing or invalid filterProfileSnapshot')
    })

    it('throws when timezone is missing', () => {
      const { timezone, ...rest } = VALID_CONFIG
      expect(() => parseRunConfig(rest)).toThrow('Invalid RunConfig: missing or invalid timezone')
    })

    it('throws when maxInputTokens is missing', () => {
      const { maxInputTokens, ...rest } = VALID_CONFIG
      expect(() => parseRunConfig(rest)).toThrow('Invalid RunConfig: missing or invalid maxInputTokens')
    })

    it('throws when promptVersionIds.summarize is not a string', () => {
      const input = { ...VALID_CONFIG, promptVersionIds: { summarize: 123 } }
      expect(() => parseRunConfig(input)).toThrow('Invalid RunConfig: promptVersionIds.summarize must be a string')
    })

    it('throws when labelSpec.model is not a string', () => {
      const input = { ...VALID_CONFIG, labelSpec: { model: 42, promptVersionId: 'x' } }
      expect(() => parseRunConfig(input)).toThrow('Invalid RunConfig: labelSpec.model must be a string')
    })

    it('throws when filterProfileSnapshot.categories is not an array', () => {
      const input = {
        ...VALID_CONFIG,
        filterProfileSnapshot: { name: 'x', mode: 'y', categories: 'notarray' },
      }
      expect(() => parseRunConfig(input)).toThrow('Invalid RunConfig: filterProfileSnapshot.categories must be an array')
    })
  })
})
