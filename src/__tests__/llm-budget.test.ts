import { describe, it, expect } from 'vitest'
import { assertWithinBudget } from '../lib/llm/budget'
import { BudgetExceededError } from '../lib/llm/errors'

describe('assertWithinBudget', () => {
  it('passes when no limits are set', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.0,
        spentUsdRunSoFar: 100.0,
        spentUsdDaySoFar: 100.0,
        policy: {},
      })
    ).not.toThrow()
  })

  it('passes when within per-run limit', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdRunSoFar: 4.80,
        spentUsdDaySoFar: 0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('passes at exactly the per-run limit', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdRunSoFar: 4.90,
        spentUsdDaySoFar: 0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('throws BudgetExceededError when per-run limit would be exceeded', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdRunSoFar: 4.90,
        spentUsdDaySoFar: 0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('thrown error has correct details for per-run', () => {
    try {
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdRunSoFar: 4.90,
        spentUsdDaySoFar: 0,
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
        spentUsdRunSoFar: 0,
        spentUsdDaySoFar: 9.0,
        policy: { maxUsdPerDay: 10.0 },
      })
    ).not.toThrow()
  })

  it('throws BudgetExceededError when per-day limit would be exceeded', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.50,
        spentUsdRunSoFar: 0,
        spentUsdDaySoFar: 9.0,
        policy: { maxUsdPerDay: 10.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('checks per-run limit even when per-day limit is fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.20,
        spentUsdRunSoFar: 4.90,
        spentUsdDaySoFar: 1.0,
        policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 100.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('checks per-day limit even when per-run limit is fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 1.50,
        spentUsdRunSoFar: 1.0,
        spentUsdDaySoFar: 9.0,
        policy: { maxUsdPerRun: 100.0, maxUsdPerDay: 10.0 },
      })
    ).toThrow(BudgetExceededError)
  })

  it('passes when both limits are fine', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdRunSoFar: 1.0,
        spentUsdDaySoFar: 1.0,
        policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 10.0 },
      })
    ).not.toThrow()
  })

  it('handles zero nextCostUsd', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0,
        spentUsdRunSoFar: 5.0,
        spentUsdDaySoFar: 5.0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  it('handles zero spend', () => {
    expect(() =>
      assertWithinBudget({
        nextCostUsd: 0.10,
        spentUsdRunSoFar: 0,
        spentUsdDaySoFar: 0,
        policy: { maxUsdPerRun: 5.0 },
      })
    ).not.toThrow()
  })

  describe('per-day vs per-run independence', () => {
    it('per-day exceeded while per-run OK → throws with per_day limitType', () => {
      try {
        assertWithinBudget({
          nextCostUsd: 0.10,
          spentUsdRunSoFar: 1.0,
          spentUsdDaySoFar: 9.95,
          policy: { maxUsdPerRun: 50.0, maxUsdPerDay: 10.0 },
        })
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError)
        const e = err as BudgetExceededError
        expect(e.details?.limitType).toBe('per_day')
        expect(e.details?.limitUsd).toBe(10.0)
      }
    })

    it('per-run exceeded while per-day OK → throws with per_run limitType', () => {
      try {
        assertWithinBudget({
          nextCostUsd: 0.20,
          spentUsdRunSoFar: 4.90,
          spentUsdDaySoFar: 1.0,
          policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 100.0 },
        })
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError)
        const e = err as BudgetExceededError
        expect(e.details?.limitType).toBe('per_run')
        expect(e.details?.limitUsd).toBe(5.0)
      }
    })

    it('both OK → passes', () => {
      expect(() =>
        assertWithinBudget({
          nextCostUsd: 0.10,
          spentUsdRunSoFar: 2.0,
          spentUsdDaySoFar: 5.0,
          policy: { maxUsdPerRun: 5.0, maxUsdPerDay: 10.0 },
        })
      ).not.toThrow()
    })

    it('per-run uses spentUsdRunSoFar not spentUsdDaySoFar', () => {
      // Run spend is high, day spend is low
      // per-run cap of 5.0; run spend 4.90 + next 0.20 = 5.10 > 5.0 → throw
      // even though day spend is only 0.50
      expect(() =>
        assertWithinBudget({
          nextCostUsd: 0.20,
          spentUsdRunSoFar: 4.90,
          spentUsdDaySoFar: 0.50,
          policy: { maxUsdPerRun: 5.0 },
        })
      ).toThrow(BudgetExceededError)
    })

    it('per-day uses spentUsdDaySoFar not spentUsdRunSoFar', () => {
      // Day spend is high, run spend is low
      // per-day cap of 10.0; day spend 9.50 + next 1.0 = 10.50 > 10.0 → throw
      // even though run spend is only 2.0
      expect(() =>
        assertWithinBudget({
          nextCostUsd: 1.0,
          spentUsdRunSoFar: 2.0,
          spentUsdDaySoFar: 9.50,
          policy: { maxUsdPerDay: 10.0 },
        })
      ).toThrow(BudgetExceededError)
    })
  })
})
