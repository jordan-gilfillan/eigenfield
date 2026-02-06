/**
 * Anthropic Provider — Messages API wrapper
 *
 * Thin adapter: takes an LlmRequest, calls the Anthropic Messages API,
 * and returns { text, tokensIn, tokensOut, raw }.
 *
 * Never logs secrets or full prompts.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LlmRequest } from '../types'
import { LlmProviderError } from '../errors'

export interface ProviderResult {
  text: string
  tokensIn: number
  tokensOut: number
  raw: unknown
}

/**
 * Calls the Anthropic Messages API.
 *
 * @param req — LlmRequest with provider='anthropic'
 * @param apiKey — the ANTHROPIC_API_KEY value
 * @returns ProviderResult with extracted text, token counts, and raw response
 * @throws LlmProviderError on SDK/network errors
 */
export async function callAnthropic(req: LlmRequest, apiKey: string): Promise<ProviderResult> {
  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      messages: req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ...(req.system && { system: req.system }),
      ...(req.temperature !== undefined && { temperature: req.temperature }),
    })

    // Extract text from content blocks
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    const tokensIn = message.usage.input_tokens
    const tokensOut = message.usage.output_tokens

    return { text, tokensIn, tokensOut, raw: message }
  } catch (err) {
    if (Anthropic.APIError && err instanceof Anthropic.APIError) {
      throw new LlmProviderError('anthropic', err.message, {
        status: err.status,
        name: err.name,
      })
    }
    throw new LlmProviderError(
      'anthropic',
      err instanceof Error ? err.message : String(err)
    )
  }
}
