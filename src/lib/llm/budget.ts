/**
 * LLM Plumbing — Budget Guard (Spend Caps)
 *
 * Prevents accidental cost runaway by checking spend limits
 * before each LLM call.
 */

import { BudgetExceededError } from './errors'

export interface BudgetPolicy {
  maxUsdPerRun?: number
  maxUsdPerDay?: number
}

export interface BudgetCheckInput {
  nextCostUsd: number
  spentUsdRunSoFar: number
  spentUsdDaySoFar: number
  policy: BudgetPolicy
}

/**
 * Throws BudgetExceededError if the next call would exceed a spend cap.
 * Checks per-run limit against spentUsdRunSoFar and per-day limit against spentUsdDaySoFar.
 */
export function assertWithinBudget(input: BudgetCheckInput): void {
  const { nextCostUsd, spentUsdRunSoFar, spentUsdDaySoFar, policy } = input

  if (policy.maxUsdPerRun !== undefined) {
    const projectedTotal = spentUsdRunSoFar + nextCostUsd
    if (projectedTotal > policy.maxUsdPerRun) {
      throw new BudgetExceededError(
        nextCostUsd,
        spentUsdRunSoFar,
        policy.maxUsdPerRun,
        'per_run'
      )
    }
  }

  if (policy.maxUsdPerDay !== undefined) {
    const projectedTotal = spentUsdDaySoFar + nextCostUsd
    if (projectedTotal > policy.maxUsdPerDay) {
      throw new BudgetExceededError(
        nextCostUsd,
        spentUsdDaySoFar,
        policy.maxUsdPerDay,
        'per_day'
      )
    }
  }
}
