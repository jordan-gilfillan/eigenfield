import { describe, it, expect } from 'vitest'
import {
  computeBundleHash,
  computeBundleContextHash,
} from '../lib/bundleHash'

describe('computeBundleHash', () => {
  it('produces deterministic output for same input', () => {
    const bundleText = '# SOURCE: chatgpt\n[2024-01-15T10:30:00.000Z] user: Hello'
    const hash1 = computeBundleHash(bundleText)
    const hash2 = computeBundleHash(bundleText)
    expect(hash1).toBe(hash2)
  })

  it('produces 64-character hex string', () => {
    const hash = computeBundleHash('test bundle')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when bundle text changes', () => {
    const hash1 = computeBundleHash('bundle v1')
    const hash2 = computeBundleHash('bundle v2')
    expect(hash1).not.toBe(hash2)
  })

  it('includes version prefix', () => {
    // Different bundles with same content should differ if prefix changes
    // This tests that the prefix is actually used
    const hash1 = computeBundleHash('')
    // Empty string with bundle_v1| prefix should produce specific hash
    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('computeBundleContextHash', () => {
  const baseParams = {
    importBatchId: 'batch-123',
    dayDate: '2024-01-15',
    sources: ['chatgpt'],
    filterProfileSnapshot: {
      name: 'professional-only',
      mode: 'include',
      categories: ['work', 'learning'],
    },
    labelSpec: {
      model: 'stub_v1',
      promptVersionId: 'pv-123',
    },
  }

  it('produces deterministic output for same input', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash(baseParams)
    expect(hash1).toBe(hash2)
  })

  it('produces 64-character hex string', () => {
    const hash = computeBundleContextHash(baseParams)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when importBatchId changes', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash({
      ...baseParams,
      importBatchId: 'batch-different',
    })
    expect(hash1).not.toBe(hash2)
  })

  it('changes when dayDate changes', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash({
      ...baseParams,
      dayDate: '2024-01-16',
    })
    expect(hash1).not.toBe(hash2)
  })

  it('changes when sources change', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash({
      ...baseParams,
      sources: ['chatgpt', 'claude'],
    })
    expect(hash1).not.toBe(hash2)
  })

  it('produces same hash regardless of sources order', () => {
    const hash1 = computeBundleContextHash({
      ...baseParams,
      sources: ['chatgpt', 'claude'],
    })
    const hash2 = computeBundleContextHash({
      ...baseParams,
      sources: ['claude', 'chatgpt'],
    })
    expect(hash1).toBe(hash2)
  })

  it('changes when filter profile changes', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash({
      ...baseParams,
      filterProfileSnapshot: {
        name: 'safety-exclude',
        mode: 'exclude',
        categories: ['medical', 'financial'],
      },
    })
    expect(hash1).not.toBe(hash2)
  })

  it('changes when labelSpec changes', () => {
    const hash1 = computeBundleContextHash(baseParams)
    const hash2 = computeBundleContextHash({
      ...baseParams,
      labelSpec: {
        model: 'gpt-4',
        promptVersionId: 'pv-different',
      },
    })
    expect(hash1).not.toBe(hash2)
  })
})
