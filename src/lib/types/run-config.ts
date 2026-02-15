/**
 * RunConfig — shared type for Run.configJson (AUD-071)
 *
 * Single source of truth for the frozen config shape stored in Run.configJson.
 * All fields are immutable per SPEC §6.8.
 */

import type { PricingSnapshot } from '../llm/pricing'

export interface RunConfig {
  promptVersionIds: { summarize: string }
  labelSpec: { model: string; promptVersionId: string }
  filterProfileSnapshot: { name: string; mode: string; categories: string[] }
  timezone: string
  maxInputTokens: number
  pricingSnapshot?: PricingSnapshot
  importBatchIds?: string[]
}

/**
 * Validates and narrows an unknown JSON value to RunConfig.
 *
 * Validates structural presence and basic types for the 5 required fields.
 * Optional fields (pricingSnapshot, importBatchIds) are passed through when present.
 *
 * @throws Error with "Invalid RunConfig:" prefix on validation failure
 */
export function parseRunConfig(json: unknown): RunConfig {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid RunConfig: expected non-null object, got ' + typeof json)
  }

  const obj = json as Record<string, unknown>

  // promptVersionIds
  if (!obj.promptVersionIds || typeof obj.promptVersionIds !== 'object') {
    throw new Error('Invalid RunConfig: missing or invalid promptVersionIds')
  }
  const pvIds = obj.promptVersionIds as Record<string, unknown>
  if (typeof pvIds.summarize !== 'string') {
    throw new Error('Invalid RunConfig: promptVersionIds.summarize must be a string')
  }

  // labelSpec
  if (!obj.labelSpec || typeof obj.labelSpec !== 'object') {
    throw new Error('Invalid RunConfig: missing or invalid labelSpec')
  }
  const ls = obj.labelSpec as Record<string, unknown>
  if (typeof ls.model !== 'string') {
    throw new Error('Invalid RunConfig: labelSpec.model must be a string')
  }
  if (typeof ls.promptVersionId !== 'string') {
    throw new Error('Invalid RunConfig: labelSpec.promptVersionId must be a string')
  }

  // filterProfileSnapshot
  if (!obj.filterProfileSnapshot || typeof obj.filterProfileSnapshot !== 'object') {
    throw new Error('Invalid RunConfig: missing or invalid filterProfileSnapshot')
  }
  const fps = obj.filterProfileSnapshot as Record<string, unknown>
  if (typeof fps.name !== 'string') {
    throw new Error('Invalid RunConfig: filterProfileSnapshot.name must be a string')
  }
  if (typeof fps.mode !== 'string') {
    throw new Error('Invalid RunConfig: filterProfileSnapshot.mode must be a string')
  }
  if (!Array.isArray(fps.categories)) {
    throw new Error('Invalid RunConfig: filterProfileSnapshot.categories must be an array')
  }

  // timezone
  if (typeof obj.timezone !== 'string') {
    throw new Error('Invalid RunConfig: missing or invalid timezone (expected string)')
  }

  // maxInputTokens
  if (typeof obj.maxInputTokens !== 'number') {
    throw new Error('Invalid RunConfig: missing or invalid maxInputTokens (expected number)')
  }

  return json as RunConfig
}
