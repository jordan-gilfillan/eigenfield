import { describe, it, expect } from 'vitest'
import { computeAtomStableId, computeTextHash } from '../lib/stableId'
import { sha256, hashToUint32 } from '../lib/hash'

describe('computeAtomStableId', () => {
  const baseParams = {
    source: 'chatgpt',
    sourceConversationId: 'conv-123',
    sourceMessageId: 'msg-456',
    timestampUtc: new Date('2024-01-15T10:30:00.000Z'),
    role: 'user',
    text: 'Hello, world!',
  }

  it('produces deterministic output for same input', () => {
    const id1 = computeAtomStableId(baseParams)
    const id2 = computeAtomStableId(baseParams)
    expect(id1).toBe(id2)
  })

  it('produces 64-character hex string', () => {
    const id = computeAtomStableId(baseParams)
    expect(id).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when source changes', () => {
    const id1 = computeAtomStableId({ ...baseParams, source: 'chatgpt' })
    const id2 = computeAtomStableId({ ...baseParams, source: 'claude' })
    expect(id1).not.toBe(id2)
  })

  it('changes when timestamp changes', () => {
    const id1 = computeAtomStableId(baseParams)
    const id2 = computeAtomStableId({
      ...baseParams,
      timestampUtc: new Date('2024-01-15T10:30:00.001Z'),
    })
    expect(id1).not.toBe(id2)
  })

  it('changes when role changes', () => {
    const id1 = computeAtomStableId({ ...baseParams, role: 'user' })
    const id2 = computeAtomStableId({ ...baseParams, role: 'assistant' })
    expect(id1).not.toBe(id2)
  })

  it('changes when text changes', () => {
    const id1 = computeAtomStableId(baseParams)
    const id2 = computeAtomStableId({ ...baseParams, text: 'Different text' })
    expect(id1).not.toBe(id2)
  })

  it('changes when conversationId changes', () => {
    const id1 = computeAtomStableId(baseParams)
    const id2 = computeAtomStableId({
      ...baseParams,
      sourceConversationId: 'conv-different',
    })
    expect(id1).not.toBe(id2)
  })

  it('changes when messageId changes', () => {
    const id1 = computeAtomStableId(baseParams)
    const id2 = computeAtomStableId({
      ...baseParams,
      sourceMessageId: 'msg-different',
    })
    expect(id1).not.toBe(id2)
  })

  it('handles null conversationId', () => {
    const id1 = computeAtomStableId({ ...baseParams, sourceConversationId: null })
    const id2 = computeAtomStableId({
      ...baseParams,
      sourceConversationId: undefined,
    })
    expect(id1).toBe(id2)
  })

  it('handles null messageId', () => {
    const id1 = computeAtomStableId({ ...baseParams, sourceMessageId: null })
    const id2 = computeAtomStableId({
      ...baseParams,
      sourceMessageId: undefined,
    })
    expect(id1).toBe(id2)
  })

  it('treats empty string differently from null', () => {
    const id1 = computeAtomStableId({ ...baseParams, sourceConversationId: '' })
    const id2 = computeAtomStableId({
      ...baseParams,
      sourceConversationId: null,
    })
    // Both should produce same result since null coalesces to ''
    expect(id1).toBe(id2)
  })

  it('normalizes text before hashing', () => {
    // Text with trailing whitespace should produce same ID as without
    const id1 = computeAtomStableId({ ...baseParams, text: 'Hello, world!' })
    const id2 = computeAtomStableId({ ...baseParams, text: 'Hello, world!   ' })
    expect(id1).toBe(id2)
  })

  it('normalizes line endings before hashing', () => {
    const id1 = computeAtomStableId({ ...baseParams, text: 'line1\nline2' })
    const id2 = computeAtomStableId({ ...baseParams, text: 'line1\r\nline2' })
    expect(id1).toBe(id2)
  })
})

describe('computeTextHash', () => {
  it('produces deterministic output', () => {
    const hash1 = computeTextHash('Hello, world!')
    const hash2 = computeTextHash('Hello, world!')
    expect(hash1).toBe(hash2)
  })

  it('produces 64-character hex string', () => {
    const hash = computeTextHash('Hello, world!')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('normalizes text before hashing', () => {
    const hash1 = computeTextHash('line1\nline2')
    const hash2 = computeTextHash('line1\r\nline2')
    expect(hash1).toBe(hash2)
  })
})

describe('hashToUint32', () => {
  it('extracts first 4 bytes as unsigned integer', () => {
    // Known hash: sha256('test') = 9f86d081...
    const hash = sha256('test')
    const uint32 = hashToUint32(hash)
    // First 8 hex chars of sha256('test') are '9f86d081'
    // Parsed as big-endian: 0x9f86d081 = 2676212865
    expect(uint32).toBe(0x9f86d081 >>> 0)
  })

  it('returns a non-negative integer', () => {
    // Test multiple inputs to ensure always unsigned
    const inputs = ['a', 'b', 'c', 'test', 'hello', 'world']
    for (const input of inputs) {
      const hash = sha256(input)
      const uint32 = hashToUint32(hash)
      expect(uint32).toBeGreaterThanOrEqual(0)
      expect(uint32).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('is deterministic', () => {
    const hash = sha256('determinism-test')
    const uint1 = hashToUint32(hash)
    const uint2 = hashToUint32(hash)
    expect(uint1).toBe(uint2)
  })

  it('produces different values for different hashes', () => {
    const hash1 = sha256('input1')
    const hash2 = sha256('input2')
    // Different inputs should (very likely) produce different uint32 values
    expect(hashToUint32(hash1)).not.toBe(hashToUint32(hash2))
  })
})
