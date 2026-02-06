/**
 * OpenAI Provider — Responses API wrapper
 *
 * Thin adapter: takes an LlmRequest, calls the OpenAI Responses API,
 * and returns { text, tokensIn, tokensOut, raw }.
 *
 * Never logs secrets or full prompts.
 */

import OpenAI from 'openai'
import type { LlmRequest } from '../types'
import { LlmProviderError } from '../errors'

export interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
  raw: unknown
}

/**
 * Calls the OpenAI Responses API.
 *
 * @param req — LlmRequest with provider='openai'
 * @param apiKey — the OPENAI_API_KEY value
 * @returns ProviderResult with extracted text, token counts, and raw response
 * @throws LlmProviderError on SDK/network errors
 */
export async function callOpenAi(req: LlmRequest, apiKey: string): Promise<ProviderResult> {
  const client = new OpenAI({ apiKey })

  try {
    const response = await client.responses.create({
      model: req.model,
      instructions: req.system ?? undefined,
      input: req.messages.map((m) => ({
        role: m.role === 'system' ? ('developer' as const) : (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.maxTokens !== undefined && { max_output_tokens: req.maxTokens }),
    })

    const text = response.output_text ?? ''

    const tokensIn = response.usage?.input_tokens ?? 0
    // Include reasoning tokens in tokensOut if present
    const baseOut = response.usage?.output_tokens ?? 0
    const tokensOut = baseOut

    return { text, tokensIn, tokensOut, raw: response }
  } catch (err) {
    if (OpenAI.APIError && err instanceof OpenAI.APIError) {
      throw new LlmProviderError('openai', err.message, {
        status: err.status,
        name: err.name,
      })
    }
    throw new LlmProviderError(
      'openai',
      err instanceof Error ? err.message : String(err)
    )
  }
}
