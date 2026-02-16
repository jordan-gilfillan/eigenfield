import { describe, it, expect } from 'vitest'
import { determineRunStatus, type ProgressCounts } from '../tick-logic'

function counts(overrides: Partial<ProgressCounts> = {}): ProgressCounts {
  return { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, ...overrides }
}

describe('determineRunStatus', () => {
  it('returns RUNNING when any jobs are running', () => {
    expect(determineRunStatus(counts({ running: 1 }))).toBe('RUNNING')
    expect(determineRunStatus(counts({ running: 3, queued: 2, succeeded: 1 }))).toBe('RUNNING')
  })

  it('returns QUEUED when jobs queued but no work done yet', () => {
    expect(determineRunStatus(counts({ queued: 5 }))).toBe('QUEUED')
  })

  it('returns RUNNING when jobs queued and some work has been done', () => {
    expect(determineRunStatus(counts({ queued: 2, succeeded: 3 }))).toBe('RUNNING')
    expect(determineRunStatus(counts({ queued: 1, failed: 1 }))).toBe('RUNNING')
    expect(determineRunStatus(counts({ queued: 1, cancelled: 1 }))).toBe('RUNNING')
  })

  it('returns FAILED when all terminal and any failed', () => {
    expect(determineRunStatus(counts({ failed: 1 }))).toBe('FAILED')
    expect(determineRunStatus(counts({ failed: 2, succeeded: 5 }))).toBe('FAILED')
  })

  it('returns COMPLETED when all terminal and all succeeded', () => {
    expect(determineRunStatus(counts({ succeeded: 5 }))).toBe('COMPLETED')
    expect(determineRunStatus(counts({ succeeded: 3, cancelled: 1 }))).toBe('COMPLETED')
  })

  it('returns QUEUED for all-cancelled (defensive fallback)', () => {
    expect(determineRunStatus(counts({ cancelled: 3 }))).toBe('QUEUED')
  })

  it('returns QUEUED for all zeros (defensive fallback)', () => {
    expect(determineRunStatus(counts())).toBe('QUEUED')
  })

  it('handles large numbers correctly', () => {
    expect(determineRunStatus(counts({ succeeded: 1000, queued: 1 }))).toBe('RUNNING')
    expect(determineRunStatus(counts({ succeeded: 1000 }))).toBe('COMPLETED')
  })
})
