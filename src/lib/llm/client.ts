/**
 * LLM Plumbing — Client
 *
 * Single exported function: callLlm(req, ctx)
 *
 * - DRY_RUN mode returns deterministic responses (stage-aware for classify).
 * - REAL mode calls OpenAI or Anthropic via provider modules.
 */

import type { LlmRequest, LlmResponse, LlmCallContext } from './types'
import { getLlmMode, getApiKey } from './config'
import { estimateCostUsd } from './pricing'
import { callOpenAi } from './providers/openai'
import { callAnthropic } from './providers/anthropic'
import { createHash } from 'crypto'

/**
 * Computes cost using the pricing book.
 * Returns 0 for stub models or if model pricing is unknown (graceful in dry-run).
 */
function computeCost(provider: string, model: string, tokensIn: number, tokensOut: number): number {
  try {
    return estimateCostUsd({ provider: provider as 'openai' | 'anthropic', model, tokensIn, tokensOut })
  } catch {
    // Unknown model pricing — return 0 in dry-run
    return 0
  }
}

/** Core categories matching spec 7.2 stub_v1 order */
const CORE_CATEGORIES = [
  'WORK', 'LEARNING', 'CREATIVE', 'MUNDANE', 'PERSONAL', 'OTHER',
] as const

/**
 * Estimates input token count from text (chars / 4 heuristic).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Builds a combined input string from the request for token estimation.
 */
function buildInputText(req: LlmRequest): string {
  const parts: string[] = []
  if (req.system) parts.push(req.system)
  for (const msg of req.messages) {
    parts.push(`${msg.role}: ${msg.content}`)
  }
  return parts.join('\n')
}

/**
 * Dry-run response for classify stage: returns deterministic category JSON
 * based on hash of atomStableId (passed via metadata).
 */
function dryRunClassifyResponse(req: LlmRequest, ctx: LlmCallContext): LlmResponse {
  const inputText = buildInputText(req)
  const tokensIn = estimateTokens(inputText)

  const atomStableId = req.metadata?.atomStableId as string | undefined
  const seed = atomStableId ?? inputText
  const h = createHash('sha256').update(seed, 'utf8').digest('hex')
  const index = (parseInt(h.slice(0, 8), 16) >>> 0) % CORE_CATEGORIES.length
  const category = CORE_CATEGORIES[index]

  const text = JSON.stringify({ category, confidence: 0.7 })
  const tokensOut = estimateTokens(text)

  let costUsd = 0
  if (ctx.simulateCost) {
    costUsd = computeCost(req.provider, req.model, tokensIn, tokensOut)
  }

  return { text, tokensIn, tokensOut, costUsd, dryRun: true }
}

/**
 * Dry-run response: deterministic placeholder text + estimated tokens.
 */
function dryRunResponse(req: LlmRequest, ctx: LlmCallContext): LlmResponse {
  // Stage-specific dry-run responses
  if (req.metadata?.stage === 'classify') {
    return dryRunClassifyResponse(req, ctx)
  }

  const inputText = buildInputText(req)
  const tokensIn = estimateTokens(inputText)

  const text =
    `[DRY RUN] Provider: ${req.provider}, Model: ${req.model}. ` +
    `Input: ${req.messages.length} message(s), ~${tokensIn} tokens.`

  const tokensOut = estimateTokens(text)

  // Simulated cost: use pricing book for known models, 0 for stub/unknown
  let costUsd = 0
  if (ctx.simulateCost) {
    costUsd = computeCost(req.provider, req.model, tokensIn, tokensOut)
  }

  return {
    text,
    tokensIn,
    tokensOut,
    costUsd,
    dryRun: true,
  }
}

/**
 * Calls an LLM provider or returns a dry-run response.
 *
 * Real mode routes to the appropriate provider SDK (OpenAI or Anthropic),
 * extracts token counts, and computes costUsd via the pricing book.
 */
export async function callLlm(
  req: LlmRequest,
  ctx: LlmCallContext = {}
): Promise<LlmResponse> {
  const mode = getLlmMode()

  if (mode === 'dry_run') {
    return dryRunResponse(req, ctx)
  }

  // Real mode: get API key (throws MissingApiKeyError if not set)
  const apiKey = getApiKey(req.provider)

  // Call the appropriate provider
  const result = req.provider === 'anthropic'
    ? await callAnthropic(req, apiKey)
    : await callOpenAi(req, apiKey)

  // Compute cost from actual token counts using the pricing book
  let costUsd = 0
  try {
    costUsd = estimateCostUsd({
      provider: req.provider,
      model: req.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    })
  } catch {
    // Unknown model pricing — return 0 rather than failing the call
    costUsd = 0
  }

  return {
    text: result.text,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd,
    dryRun: false,
    raw: result.raw,
  }
}
