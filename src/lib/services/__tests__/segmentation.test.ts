/**
 * Tests for Segmentation (segmenter_v1)
 *
 * Spec references: 9.2 (Bundle size constraints)
 *
 * Acceptance tests for:
 * - Segmentation determinism: same atoms + config → same segments
 * - Stable segment IDs
 * - Correct segment boundaries
 */

import { describe, it, expect } from 'vitest'
import { segmentBundle, estimateTokens } from '../bundle'
import { sha256 } from '../../hash'

describe('segmenter_v1', () => {
  // Helper to create test atoms
  const createTestAtoms = (count: number, textLength: number = 100) => {
    const atoms = []
    const baseTime = new Date('2024-01-15T10:00:00Z')

    for (let i = 0; i < count; i++) {
      atoms.push({
        id: `atom-${i}`,
        atomStableId: `stable-${i}`,
        source: 'chatgpt',
        timestampUtc: new Date(baseTime.getTime() + i * 1000),
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `Message ${i}: ${'x'.repeat(textLength)}`,
      })
    }
    return atoms
  }

  describe('determinism', () => {
    it('produces identical segments for same atoms + config', () => {
      const atoms = createTestAtoms(10, 200)
      const bundleHash = sha256('test-bundle')
      const maxTokens = 500

      // Run segmentation twice
      const result1 = segmentBundle(atoms, bundleHash, maxTokens)
      const result2 = segmentBundle(atoms, bundleHash, maxTokens)

      // Verify identical results
      expect(result1.segmentCount).toBe(result2.segmentCount)
      expect(result1.wasSegmented).toBe(result2.wasSegmented)

      for (let i = 0; i < result1.segments.length; i++) {
        expect(result1.segments[i].segmentId).toBe(result2.segments[i].segmentId)
        expect(result1.segments[i].text).toBe(result2.segments[i].text)
        expect(result1.segments[i].atomIds).toEqual(result2.segments[i].atomIds)
      }
    })

    it('produces different segments for different maxTokens', () => {
      const atoms = createTestAtoms(10, 200)
      const bundleHash = sha256('test-bundle')

      const result500 = segmentBundle(atoms, bundleHash, 500)
      const result1000 = segmentBundle(atoms, bundleHash, 1000)

      // Different max tokens should produce different segment counts
      expect(result500.segmentCount).toBeGreaterThan(result1000.segmentCount)
    })

    it('produces different segment IDs for different bundleHash', () => {
      const atoms = createTestAtoms(5, 200)

      const result1 = segmentBundle(atoms, sha256('bundle-a'), 500)
      const result2 = segmentBundle(atoms, sha256('bundle-b'), 500)

      // Same segment count but different IDs
      expect(result1.segmentCount).toBe(result2.segmentCount)
      expect(result1.segments[0].segmentId).not.toBe(result2.segments[0].segmentId)
    })
  })

  describe('stable segment IDs', () => {
    it('generates segment ID per spec: sha256("segment_v1|" + bundleHash + "|" + index)', () => {
      const atoms = createTestAtoms(3, 100)
      const bundleHash = 'abc123hash'
      const maxTokens = 100 // Force multiple segments

      const result = segmentBundle(atoms, bundleHash, maxTokens)

      for (const segment of result.segments) {
        const expectedId = sha256(`segment_v1|${bundleHash}|${segment.index}`)
        expect(segment.segmentId).toBe(expectedId)
      }
    })
  })

  describe('segment boundaries', () => {
    it('does not segment when within budget', () => {
      const atoms = createTestAtoms(3, 50) // Small atoms
      const bundleHash = sha256('test')
      const maxTokens = 10000 // Large budget

      const result = segmentBundle(atoms, bundleHash, maxTokens)

      expect(result.wasSegmented).toBe(false)
      expect(result.segmentCount).toBe(1)
      expect(result.segments[0].atomIds).toHaveLength(3)
    })

    it('segments when exceeding budget', () => {
      const atoms = createTestAtoms(10, 500) // Large atoms
      const bundleHash = sha256('test')
      const maxTokens = 500 // Small budget

      const result = segmentBundle(atoms, bundleHash, maxTokens)

      expect(result.wasSegmented).toBe(true)
      expect(result.segmentCount).toBeGreaterThan(1)
    })

    it('never splits an atom across segments', () => {
      const atoms = createTestAtoms(5, 300)
      const bundleHash = sha256('test')
      const maxTokens = 200 // Force segmentation

      const result = segmentBundle(atoms, bundleHash, maxTokens)

      // Collect all atom IDs across all segments
      const allAtomIds = result.segments.flatMap((s) => s.atomIds)

      // Should have exactly the input atoms (no duplicates, no missing)
      expect(allAtomIds).toHaveLength(atoms.length)
      expect(new Set(allAtomIds).size).toBe(atoms.length)
    })

    it('preserves atom order across segments', () => {
      const atoms = createTestAtoms(10, 200)
      const bundleHash = sha256('test')
      const maxTokens = 300

      const result = segmentBundle(atoms, bundleHash, maxTokens)

      // Collect all atom IDs in order
      const allAtomIds = result.segments.flatMap((s) => s.atomIds)

      // Verify order matches input
      for (let i = 0; i < allAtomIds.length; i++) {
        expect(allAtomIds[i]).toBe(atoms[i].id)
      }
    })
  })

  describe('segment content', () => {
    it('includes source header in segment text', () => {
      const atoms = createTestAtoms(2, 50)
      const bundleHash = sha256('test')

      const result = segmentBundle(atoms, bundleHash, 10000)

      expect(result.segments[0].text).toContain('# SOURCE: chatgpt')
    })

    it('includes formatted atom lines', () => {
      const atoms = createTestAtoms(2, 50)
      const bundleHash = sha256('test')

      const result = segmentBundle(atoms, bundleHash, 10000)

      // Check for timestamp format and role
      expect(result.segments[0].text).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] user:/)
      expect(result.segments[0].text).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] assistant:/)
    })
  })

  describe('edge cases', () => {
    it('handles empty atoms array', () => {
      const result = segmentBundle([], sha256('test'), 1000)

      expect(result.segmentCount).toBe(0)
      expect(result.segments).toHaveLength(0)
      expect(result.wasSegmented).toBe(false)
    })

    it('handles single atom', () => {
      const atoms = createTestAtoms(1, 50)

      const result = segmentBundle(atoms, sha256('test'), 1000)

      expect(result.segmentCount).toBe(1)
      expect(result.wasSegmented).toBe(false)
      expect(result.segments[0].atomIds).toEqual(['atom-0'])
    })

    it('handles multiple sources', () => {
      const atoms = [
        {
          id: 'a1',
          atomStableId: 's1',
          source: 'chatgpt',
          timestampUtc: new Date('2024-01-15T10:00:00Z'),
          role: 'user',
          text: 'Hello from ChatGPT',
        },
        {
          id: 'a2',
          atomStableId: 's2',
          source: 'claude',
          timestampUtc: new Date('2024-01-15T10:01:00Z'),
          role: 'assistant',
          text: 'Hello from Claude',
        },
      ]

      const result = segmentBundle(atoms, sha256('test'), 10000)

      expect(result.segments[0].text).toContain('# SOURCE: chatgpt')
      expect(result.segments[0].text).toContain('# SOURCE: claude')
    })
  })

  describe('estimateTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(estimateTokens('1234')).toBe(1) // 4 chars = 1 token
      expect(estimateTokens('12345678')).toBe(2) // 8 chars = 2 tokens
      expect(estimateTokens('123')).toBe(1) // 3 chars rounds up to 1 token
    })

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })
  })
})
