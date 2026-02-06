/**
 * LLM Plumbing — Pricing Book + Cost Calculator
 *
 * Single source of truth for per-provider/per-model token rates.
 * Update these rates when provider pricing changes; source: official pricing pages.
 *
 * PR-3b0.1: No web fetches at runtime. All pricing is committed in repo.
 */

import { UnknownModelPricingError } from './errors'
import { getDefaultProvider } from './config'
import type { ProviderId } from './types'

export interface Rate {
  inputPer1MUsd: number
  outputPer1MUsd: number
  cachedInputPer1MUsd?: number
}

export interface EstimateCostInput {
  provider: ProviderId
  model: string
  tokensIn: number
  tokensOut: number
  cachedInTokens?: number
}

export interface PricingSnapshot {
  provider: ProviderId
  model: string
  inputPer1MUsd: number
  outputPer1MUsd: number
  cachedInputPer1MUsd?: number
  capturedAt: string // ISO timestamp
}

/**
 * Infers provider from model string.
 * Falls back to env default, then to 'openai'.
 */
export function inferProvider(model: string): ProviderId {
  const lower = model.toLowerCase()
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic'
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3')) return 'openai'
  return getDefaultProvider() ?? 'openai'
}

/**
 * Rate table keyed by provider, then model.
 * Rates are USD per 1M tokens.
 */
const RATE_TABLE: Record<string, Record<string, Rate>> = {
  openai: {
    'gpt-4o': {
      inputPer1MUsd: 2.5,
      outputPer1MUsd: 10.0,
      cachedInputPer1MUsd: 1.25,
    },
    'gpt-4o-mini': {
      inputPer1MUsd: 0.15,
      outputPer1MUsd: 0.6,
      cachedInputPer1MUsd: 0.075,
    },
    'gpt-4.1': {
      inputPer1MUsd: 2.0,
      outputPer1MUsd: 8.0,
      cachedInputPer1MUsd: 0.5,
    },
    'gpt-4.1-mini': {
      inputPer1MUsd: 0.4,
      outputPer1MUsd: 1.6,
      cachedInputPer1MUsd: 0.1,
    },
    'gpt-4.1-nano': {
      inputPer1MUsd: 0.1,
      outputPer1MUsd: 0.4,
      cachedInputPer1MUsd: 0.025,
    },
  },
  anthropic: {
    'claude-sonnet-4-5': {
      inputPer1MUsd: 3.0,
      outputPer1MUsd: 15.0,
      cachedInputPer1MUsd: 0.3,
    },
    'claude-3-5-sonnet': {
      inputPer1MUsd: 3.0,
      outputPer1MUsd: 15.0,
      cachedInputPer1MUsd: 0.3,
    },
    'claude-3-5-haiku': {
      inputPer1MUsd: 0.8,
      outputPer1MUsd: 4.0,
      cachedInputPer1MUsd: 0.08,
    },
  },
}

/**
 * Returns the rate for a given provider+model.
 * Stub models (starting with "stub") return zero rates.
 * Throws UnknownModelPricingError if model is not in the rate table.
 */
export function getRate(provider: ProviderId | string, model: string): Rate {
  // Stub models always cost $0
  if (model.startsWith('stub') || provider === 'stub') {
    return { inputPer1MUsd: 0, outputPer1MUsd: 0 }
  }

  const providerRates = RATE_TABLE[provider]
  if (!providerRates) {
    throw new UnknownModelPricingError(provider, model)
  }

  const rate = providerRates[model]
  if (!rate) {
    throw new UnknownModelPricingError(provider, model)
  }

  return rate
}

/**
 * Computes estimated cost in USD from token counts and the rate table.
 * Stub models return 0. Unknown models throw UnknownModelPricingError.
 *
 * Stores full precision internally; rounding to cents is done at display time.
 */
export function estimateCostUsd(input: EstimateCostInput): number {
  const rate = getRate(input.provider, input.model)

  const inputCost = (input.tokensIn / 1_000_000) * rate.inputPer1MUsd
  const outputCost = (input.tokensOut / 1_000_000) * rate.outputPer1MUsd

  let cachedCost = 0
  if (input.cachedInTokens && rate.cachedInputPer1MUsd !== undefined) {
    cachedCost = (input.cachedInTokens / 1_000_000) * rate.cachedInputPer1MUsd
  }

  return inputCost + outputCost + cachedCost
}

/**
 * Builds a PricingSnapshot for a provider+model at the current time.
 * Throws UnknownModelPricingError if model has no known pricing.
 */
export function buildPricingSnapshot(provider: ProviderId | string, model: string): PricingSnapshot {
  const rate = getRate(provider, model)

  const snapshot: PricingSnapshot = {
    provider: provider as ProviderId,
    model,
    inputPer1MUsd: rate.inputPer1MUsd,
    outputPer1MUsd: rate.outputPer1MUsd,
    capturedAt: new Date().toISOString(),
  }

  if (rate.cachedInputPer1MUsd !== undefined) {
    snapshot.cachedInputPer1MUsd = rate.cachedInputPer1MUsd
  }

  return snapshot
}

/**
 * Computes cost from a PricingSnapshot (for use with stored snapshots).
 */
export function estimateCostFromSnapshot(
  snapshot: Pick<PricingSnapshot, 'inputPer1MUsd' | 'outputPer1MUsd' | 'cachedInputPer1MUsd'>,
  tokensIn: number,
  tokensOut: number,
  cachedInTokens?: number
): number {
  const inputCost = (tokensIn / 1_000_000) * snapshot.inputPer1MUsd
  const outputCost = (tokensOut / 1_000_000) * snapshot.outputPer1MUsd

  let cachedCost = 0
  if (cachedInTokens && snapshot.cachedInputPer1MUsd !== undefined) {
    cachedCost = (cachedInTokens / 1_000_000) * snapshot.cachedInputPer1MUsd
  }

  return inputCost + outputCost + cachedCost
}
