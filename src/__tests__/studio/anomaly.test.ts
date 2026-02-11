import { describe, it, expect } from 'vitest'
import { getMedianCost, getAnomalousDays } from '../../app/distill/studio/lib/anomaly'

describe('Studio anomaly detection', () => {
  describe('getMedianCost', () => {
    it('returns null when fewer than 3 eligible costs', () => {
      expect(getMedianCost([])).toBeNull()
      expect(getMedianCost([
        { status: 'succeeded', costUsd: 0.10 },
      ])).toBeNull()
      expect(getMedianCost([
        { status: 'succeeded', costUsd: 0.10 },
        { status: 'succeeded', costUsd: 0.20 },
      ])).toBeNull()
    })

    it('excludes non-succeeded jobs', () => {
      expect(getMedianCost([
        { status: 'succeeded', costUsd: 0.10 },
        { status: 'succeeded', costUsd: 0.20 },
        { status: 'failed', costUsd: 0.30 },
      ])).toBeNull() // only 2 succeeded
    })

    it('excludes costUsd === 0 from median calculation', () => {
      expect(getMedianCost([
        { status: 'succeeded', costUsd: 0 },
        { status: 'succeeded', costUsd: 0.10 },
        { status: 'succeeded', costUsd: 0.20 },
      ])).toBeNull() // only 2 with costUsd > 0
    })

    it('returns median for odd number of eligible costs', () => {
      const result = getMedianCost([
        { status: 'succeeded', costUsd: 0.10 },
        { status: 'succeeded', costUsd: 0.30 },
        { status: 'succeeded', costUsd: 0.20 },
      ])
      expect(result).toBe(0.20)
    })

    it('returns average of two middle values for even count', () => {
      const result = getMedianCost([
        { status: 'succeeded', costUsd: 0.10 },
        { status: 'succeeded', costUsd: 0.20 },
        { status: 'succeeded', costUsd: 0.30 },
        { status: 'succeeded', costUsd: 0.40 },
      ])
      expect(result).toBe(0.25) // (0.20 + 0.30) / 2
    })

    it('handles all identical costs', () => {
      const result = getMedianCost([
        { status: 'succeeded', costUsd: 0.15 },
        { status: 'succeeded', costUsd: 0.15 },
        { status: 'succeeded', costUsd: 0.15 },
      ])
      expect(result).toBe(0.15)
    })
  })

  describe('getAnomalousDays', () => {
    it('returns empty set when fewer than 3 eligible costs', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 10.00 },
      ])
      expect(result.size).toBe(0)
    })

    it('badges days with cost > 2x median', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-03', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-04', status: 'succeeded', costUsd: 0.50 }, // > 2 * 0.10
      ])
      // median = 0.10, threshold = 0.20
      expect(result.size).toBe(1)
      expect(result.has('2025-01-04')).toBe(true)
    })

    it('does not badge days at exactly 2x median', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-03', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-04', status: 'succeeded', costUsd: 0.20 }, // exactly 2x
      ])
      expect(result.size).toBe(0)
    })

    it('does not badge failed or zero-cost days', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-03', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-04', status: 'failed', costUsd: 5.00 },
        { dayDate: '2025-01-05', status: 'succeeded', costUsd: 0 },
      ])
      expect(result.size).toBe(0)
    })

    it('returns empty set when all costs are identical', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-03', status: 'succeeded', costUsd: 0.10 },
      ])
      // median = 0.10, threshold = 0.20, no cost > 0.20
      expect(result.size).toBe(0)
    })

    it('handles mixed statuses correctly', () => {
      const result = getAnomalousDays([
        { dayDate: '2025-01-01', status: 'succeeded', costUsd: 0.10 },
        { dayDate: '2025-01-02', status: 'succeeded', costUsd: 0.12 },
        { dayDate: '2025-01-03', status: 'succeeded', costUsd: 0.11 },
        { dayDate: '2025-01-04', status: 'queued', costUsd: 0 },
        { dayDate: '2025-01-05', status: 'succeeded', costUsd: 0.80 }, // anomaly
        { dayDate: '2025-01-06', status: 'failed', costUsd: 0.05 },
      ])
      // eligible: [0.10, 0.11, 0.12, 0.80], median = (0.11 + 0.12)/2 = 0.115
      // threshold = 0.23, only 0.80 > 0.23
      expect(result.size).toBe(1)
      expect(result.has('2025-01-05')).toBe(true)
    })
  })
})
