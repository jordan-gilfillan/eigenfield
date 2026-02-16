import { describe, it, expect } from 'vitest'
import { chunkArray, IMPORT_CHUNK_SIZE } from '../../lib/services/import'

describe('chunkArray', () => {
  it('returns [] for empty input', () => {
    expect(chunkArray([], 5)).toEqual([])
  })

  it('returns single chunk when array is smaller than size', () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]])
  })

  it('returns single chunk when array equals size', () => {
    expect(chunkArray([1, 2, 3], 3)).toEqual([[1, 2, 3]])
  })

  it('splits correctly with remainder', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('splits evenly', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]])
  })

  it('handles size=1 (one element per chunk)', () => {
    expect(chunkArray(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']])
  })

  it('throws if size is 0', () => {
    expect(() => chunkArray([1], 0)).toThrow('chunkArray: size must be positive, got 0')
  })

  it('throws if size is negative', () => {
    expect(() => chunkArray([1], -1)).toThrow('chunkArray: size must be positive, got -1')
  })
})

describe('IMPORT_CHUNK_SIZE', () => {
  it('is a positive number', () => {
    expect(IMPORT_CHUNK_SIZE).toBeGreaterThan(0)
    expect(IMPORT_CHUNK_SIZE).toBe(1000)
  })
})
