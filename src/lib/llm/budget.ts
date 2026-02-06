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
  spentUsdSoFar: number
  policy: BudgetPolicy
}

/**
 * Throws BudgetExceededError if the next call would exceed a spend cap.
 * Checks per-run limit against spentUsdSoFar.
 */
export function assertWithinBudget(input: BudgetCheckInput): void {
  const { nextCostUsd, spentUsdSoFar, policy } = input

  if (policy.maxUsdPerRun !== undefined) {
    const projectedTotal = spentUsdSoFar + nextCostUsd
    if (projectedTotal > policy.maxUsdPerRun) {
      throw new BudgetExceededError(
        nextCostUsd,
        spentUsdSoFar,
        policy.maxUsdPerRun,
        'per_run'
      )
    }
  }

  if (policy.maxUsdPerDay !== undefined) {
    const projectedTotal = spentUsdSoFar + nextCostUsd
    if (projectedTotal > policy.maxUsdPerDay) {
      throw new BudgetExceededError(
        nextCostUsd,
        spentUsdSoFar,
        policy.maxUsdPerDay,
        'per_day'
      )
    }
  }
}
