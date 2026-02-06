/**
 * LLM Plumbing — Client
 *
 * Single exported function: callLlm(req, ctx)
 *
 * In PR-3b0:
 * - DRY_RUN mode returns deterministic placeholder text + estimated tokens.
 * - REAL mode throws ProviderNotImplementedError (to be filled in PR-3b.1/4b).
 */

import type { LlmRequest, LlmResponse, LlmCallContext } from './types'
import { getLlmMode, requireApiKeyForRealMode } from './config'
import { ProviderNotImplementedError } from './errors'

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
 * Dry-run response: deterministic placeholder text + estimated tokens.
 */
function dryRunResponse(req: LlmRequest, ctx: LlmCallContext): LlmResponse {
  const inputText = buildInputText(req)
  const tokensIn = estimateTokens(inputText)

  const text =
    `[DRY RUN] Provider: ${req.provider}, Model: ${req.model}. ` +
    `Input: ${req.messages.length} message(s), ~${tokensIn} tokens.`

  const tokensOut = estimateTokens(text)

  // Simulated cost: use a rough per-token rate if simulateCost is set
  let costUsd = 0
  if (ctx.simulateCost) {
    // Rough estimate: $0.01 per 1K input tokens, $0.03 per 1K output tokens
    costUsd = (tokensIn / 1000) * 0.01 + (tokensOut / 1000) * 0.03
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
 * In PR-3b0, real mode throws ProviderNotImplementedError.
 * PR-3b.1 / PR-4b will replace the real path with actual provider calls.
 */
export async function callLlm(
  req: LlmRequest,
  ctx: LlmCallContext = {}
): Promise<LlmResponse> {
  const mode = getLlmMode()

  if (mode === 'dry_run') {
    return dryRunResponse(req, ctx)
  }

  // Real mode: validate API key first, then fail with not-implemented
  requireApiKeyForRealMode(req.provider)
  throw new ProviderNotImplementedError(req.provider)
}
