/**
 * LLM Plumbing — Public API
 *
 * Re-exports for consumers.
 */

export { callLlm } from './client'
export { getLlmMode, getDefaultProvider, getApiKey, getMinDelayMs, getSpendCaps } from './config'
export { RateLimiter } from './rateLimit'
export type { Clock, RateLimiterOptions } from './rateLimit'
export { assertWithinBudget } from './budget'
export type { BudgetPolicy, BudgetCheckInput } from './budget'
export { LlmError, MissingApiKeyError, ProviderNotImplementedError, BudgetExceededError, LlmBadOutputError, UnknownModelPricingError } from './errors'
export { getRate, estimateCostUsd, buildPricingSnapshot, estimateCostFromSnapshot, inferProvider } from './pricing'
export type { Rate, EstimateCostInput, PricingSnapshot } from './pricing'
export type { ProviderId, LlmMode, LlmMessage, LlmRequest, LlmResponse, LlmCallContext } from './types'
