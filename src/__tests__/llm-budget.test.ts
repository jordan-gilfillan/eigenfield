import { describe, it, expect } from 'vitest'
import { assertWithinBudget } from '../lib/llm/budget'
import { BudgetExceededError } from '../lib/llm/errors'

describe('assertWithinBudget', () => {
  it('passes when no limits are set', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.0,
        spentUsdSoFar: 100.0,
        policy: {},
      })
    ).not.toThrow()
  })

  it('passes when within per-run limit', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdSoFar: 4.80,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('passes at exactly the per-run limit', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdSoFar: 4.90,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('throws BudgetExceededError when per-run limit would be exceeded', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdSoFar: 4.90,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('thrown error has correct details for per-run', () => {
    try {
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdSoFar: 4.90,
        policy: { maxUsdPerRun: 5.0 },
      })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError)
      const e = err as BudgetExceededError
      expect(e.code).toBe('BUDGET_EXCEEDED')
      expect(e.details?.limitType).toBe('per_run')
      expect(e.details?.limitUsd).toBe(5.0)
    }
  })

  it('passes when within per-day limit', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.50,
        spentUsdSoFar: 9.0,
        policy: { maxUsdPerDay: 10.0 },
      })
    ).not.toThrow()
  })

  it('throws BudgetExceededError when per-day limit would be exceeded', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.50,
        spentUsdSoFar: 9.0,
        policy: { maxUsdPerDay: 10.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('checks per-run limit even when per-day limit is fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdSoFar: 4.90,
        policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 100.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('checks per-day limit even when per-run limit is fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.50,
        spentUsdSoFar: 9.0,
        policy: { maxUsdPerRun: 100.0, maxUsdPerDay: 10.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('passes when both limits are fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdSoFar: 1.0,
        policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 10.0 },
      })
    ).not.toThrow()
  })

  it('handles zero nextCostUsd', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0,
        spentUsdSoFar: 5.0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('handles zero spentUsdSoFar', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdSoFar: 0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })
})
