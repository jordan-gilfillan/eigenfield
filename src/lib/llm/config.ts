/**
 * LLM Plumbing — Configuration
 *
 * Reads env vars for LLM provider configuration.
 * Never logs secrets.
 */

import type { ProviderId, LlmMode } from './types'
import { MissingApiKeyError } from './errors'

const ENV_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

/**
 * Returns the current LLM mode.
 * Defaults to 'dry_run' when LLM_MODE is unset or invalid.
 */
export function getLlmMode(): LlmMode {
  const raw = process.env.LLM_MODE?.trim().toLowerCase()
  if (raw === 'real') return 'real'
  return 'dry_run'
}

/**
 * Returns the default provider from env, or undefined if unset.
 */
export function getDefaultProvider(): ProviderId | undefined {
  const raw = process.env.LLM_PROVIDER_DEFAULT?.trim().toLowerCase()
  if (raw === 'openai' || raw === 'anthropic') return raw
  return undefined
}

/**
 * Returns the API key for a provider.
 * Throws MissingApiKeyError if not set and mode is 'real'.
 */
export function getApiKey(provider: ProviderId): string {
  const envVar = ENV_KEYS[provider]
  const key = process.env[envVar]?.trim()
  if (!key) {
    throw new MissingApiKeyError(provider)
  }
  return key
}

/**
 * Validates that the API key is available for the given provider.
 * Only enforced in real mode — dry_run never needs keys.
 */
export function requireApiKeyForRealMode(provider: ProviderId): void {
  if (getLlmMode() === 'real') {
    getApiKey(provider) // throws if missing
  }
}

/**
 * Returns the minimum delay between LLM calls in milliseconds.
 * Defaults to 250ms.
 */
export function getMinDelayMs(): number {
  const raw = process.env.LLM_MIN_DELAY_MS?.trim()
  if (raw) {
    const parsed = parseInt(raw, 10)
    if (!isNaN(parsed) && parsed >= 0) return parsed
  }
  return 250
}

/**
 * Returns spend cap configuration from env.
 */
export function getSpendCaps(): { maxUsdPerRun?: number; maxUsdPerDay?: number } {
  const result: { maxUsdPerRun?: number; maxUsdPerDay?: number } = {}

  const perRun = process.env.LLM_MAX_USD_PER_RUN?.trim()
  if (perRun) {
    const parsed = parseFloat(perRun)
    if (!isNaN(parsed) && parsed > 0) result.maxUsdPerRun = parsed
  }

  const perDay = process.env.LLM_MAX_USD_PER_DAY?.trim()
  if (perDay) {
    const parsed = parseFloat(perDay)
    if (!isNaN(parsed) && parsed > 0) result.maxUsdPerDay = parsed
  }

  return result
}
