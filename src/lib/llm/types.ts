/**
 * LLM Plumbing — Type Definitions
 *
 * Provider abstraction for OpenAI / Anthropic API calls.
 * PR-3b0: shared plumbing only (dry-run, rate limit, spend caps).
 */

export type ProviderId = 'openai' | 'anthropic'

export type LlmMode = 'dry_run' | 'real'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  provider: ProviderId
  model: string
  system?: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  metadata?: Record<string, unknown>
}

export interface LlmResponse {
  text: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  dryRun: boolean
  raw?: unknown
}

export interface LlmCallContext {
  /** Cumulative USD spent so far in this run/session */
  spentUsdSoFar?: number
  /** If true, dry-run returns a simulated non-zero costUsd */
  simulateCost?: boolean
}
