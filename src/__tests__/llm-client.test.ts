import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { callLlm } from '../lib/llm/client'
import { ProviderNotImplementedError, MissingApiKeyError } from '../lib/llm/errors'
import type { LlmRequest } from '../lib/llm/types'

describe('callLlm', () => {
  const originalEnv = { ...process.env }

  const baseRequest: LlmRequest = {
    provider: 'openai',
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello world' }],
  }

  beforeEach(() => {
    delete process.env.LLM_MODE
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('dry_run mode (default)', () => {
    it('returns a response without making external calls', async () => {
      const resp = await callLlm(baseRequest)
      expect(resp.dryRun).toBe(true)
      expect(resp.text).toContain('[DRY RUN]')
      expect(resp.text).toContain('openai')
      expect(resp.text).toContain('gpt-4o')
    })

    it('returns numeric tokensIn and tokensOut', async () => {
      const resp = await callLlm(baseRequest)
      expect(typeof resp.tokensIn).toBe('number')
      expect(typeof resp.tokensOut).toBe('number')
      expect(resp.tokensIn).toBeGreaterThan(0)
      expect(resp.tokensOut).toBeGreaterThan(0)
    })

    it('returns costUsd=0 by default', async () => {
      const resp = await callLlm(baseRequest)
      expect(resp.costUsd).toBe(0)
    })

    it('returns non-zero costUsd when simulateCost is set', async () => {
      const resp = await callLlm(baseRequest, { simulateCost: true })
      expect(resp.costUsd).toBeGreaterThan(0)
    })

    it('includes system message in token estimation', async () => {
      const withSystem: LlmRequest = {
        ...baseRequest,
        system: 'You are a helpful assistant with extensive knowledge.',
      }
      const withoutSystem = await callLlm(baseRequest)
      const withSystemResp = await callLlm(withSystem)
      expect(withSystemResp.tokensIn).toBeGreaterThan(withoutSystem.tokensIn)
    })

    it('token count scales with message count', async () => {
      const singleMsg = await callLlm(baseRequest)
      const multiMsg = await callLlm({
        ...baseRequest,
        messages: [
          { role: 'user', content: 'Hello world' },
          { role: 'assistant', content: 'Hi there! How can I help?' },
          { role: 'user', content: 'Tell me about the weather' },
        ],
      })
      expect(multiMsg.tokensIn).toBeGreaterThan(singleMsg.tokensIn)
    })

    it('is deterministic (same input → same output)', async () => {
      const resp1 = await callLlm(baseRequest)
      const resp2 = await callLlm(baseRequest)
      expect(resp1.text).toBe(resp2.text)
      expect(resp1.tokensIn).toBe(resp2.tokensIn)
      expect(resp1.tokensOut).toBe(resp2.tokensOut)
      expect(resp1.costUsd).toBe(resp2.costUsd)
    })

    it('does not require API keys', async () => {
      // No keys set, should still work
      const resp = await callLlm(baseRequest)
      expect(resp.dryRun).toBe(true)
    })

    it('works with anthropic provider', async () => {
      const resp = await callLlm({
        ...baseRequest,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      })
      expect(resp.dryRun).toBe(true)
      expect(resp.text).toContain('anthropic')
      expect(resp.text).toContain('claude-3-5-sonnet')
    })

    it('includes message count in dry-run text', async () => {
      const resp = await callLlm({
        ...baseRequest,
        messages: [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: 'B' },
        ],
      })
      expect(resp.text).toContain('2 message(s)')
    })
  })

  describe('real mode', () => {
    beforeEach(() => {
      process.env.LLM_MODE = 'real'
    })

    it('throws MissingApiKeyError when key is not set', async () => {
      await expect(callLlm(baseRequest)).rejects.toThrow(MissingApiKeyError)
    })

    it('throws ProviderNotImplementedError when key is set', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      await expect(callLlm(baseRequest)).rejects.toThrow(
        ProviderNotImplementedError
      )
    })

    it('ProviderNotImplementedError has correct code', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key'
      try {
        await callLlm(baseRequest)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderNotImplementedError)
        const e = err as ProviderNotImplementedError
        expect(e.code).toBe('PROVIDER_NOT_IMPLEMENTED')
        expect(e.details?.provider).toBe('openai')
      }
    })

    it('validates key before throwing not-implemented for anthropic', async () => {
      // No anthropic key set
      await expect(
        callLlm({ ...baseRequest, provider: 'anthropic' })
      ).rejects.toThrow(MissingApiKeyError)
    })
  })
})
