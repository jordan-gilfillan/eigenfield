/**
 * LLM Plumbing — Error Classes
 *
 * Typed errors that can be translated into spec-style { error: { code, message } }
 * payloads by API routes.
 */

export class LlmError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.details = details
  }
}

export class MissingApiKeyError extends LlmError {
  constructor(provider: string) {
    super(
      'MISSING_API_KEY',
      `API key not configured for provider "${provider}". Set the corresponding environment variable.`,
      { provider }
    )
    this.name = 'MissingApiKeyError'
  }
}

export class ProviderNotImplementedError extends LlmError {
  constructor(provider: string) {
    super(
      'PROVIDER_NOT_IMPLEMENTED',
      `Provider "${provider}" is not yet implemented. Use dry_run mode or wait for PR-3b.1/4b.`,
      { provider }
    )
    this.name = 'ProviderNotImplementedError'
  }
}

export class BudgetExceededError extends LlmError {
  constructor(
    nextCostUsd: number,
    spentUsdSoFar: number,
    limitUsd: number,
    limitType: 'per_run' | 'per_day'
  ) {
    super(
      'BUDGET_EXCEEDED',
      `Budget exceeded: next call would cost $${nextCostUsd.toFixed(4)}, ` +
        `already spent $${spentUsdSoFar.toFixed(4)} against ${limitType} limit of $${limitUsd.toFixed(4)}.`,
      { nextCostUsd, spentUsdSoFar, limitUsd, limitType }
    )
    this.name = 'BudgetExceededError'
  }
}

export class LlmBadOutputError extends LlmError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('LLM_BAD_OUTPUT', message, details)
    this.name = 'LlmBadOutputError'
  }
}

export class UnknownModelPricingError extends LlmError {
  constructor(provider: string, model: string) {
    super(
      'UNKNOWN_MODEL_PRICING',
      `No pricing data for provider "${provider}", model "${model}". Add it to the rate table in src/lib/llm/pricing.ts.`,
      { provider, model }
    )
    this.name = 'UnknownModelPricingError'
  }
}
