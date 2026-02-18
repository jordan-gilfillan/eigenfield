/**
 * Tests for POST /api/distill/import — sourceOverride validation
 *
 * AUD-052: reject sourceOverride=mixed (SPEC §6.1)
 *
 * All tests are DB-free: they exercise validation paths that return
 * before any Prisma/import-service work.
 */

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest whose formData() returns the given entries. */
function importRequest(fields: Record<string, string | Blob>): NextRequest {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v)
  }
  return new NextRequest('http://localhost:3000/api/distill/import', {
    method: 'POST',
    body: fd,
  })
}

/** Shortcut: request with only a sourceOverride (no file). */
function sourceOnlyRequest(source: string): NextRequest {
  return importRequest({ sourceOverride: source })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/distill/import — sourceOverride validation', () => {
  it('rejects sourceOverride=mixed with 400 INVALID_INPUT (AUD-052)', async () => {
    const res = await POST(sourceOnlyRequest('mixed'))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.message).toContain('reserved')

    // Contract: validSources must not include 'mixed'
    const validSources: string[] = body.error.details.validSources
    expect(validSources).not.toContain('mixed')
    expect(validSources).toContain('chatgpt')
    expect(validSources).toContain('claude')
    expect(validSources).toContain('grok')
  })

  it('rejects sourceOverride=bogus with 400 INVALID_INPUT', async () => {
    const res = await POST(sourceOnlyRequest('bogus'))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.message).toContain('Invalid source')
  })

  it('accepts sourceOverride=chatgpt (fails later on missing file, not source)', async () => {
    // Send valid source but no file — route should pass source validation
    // and fail on the file-missing check instead.
    const res = await POST(sourceOnlyRequest('chatgpt'))
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.message).toContain('No file provided')
    // Crucially, not a source-related error
    expect(body.error.message).not.toContain('Invalid source')
    expect(body.error.message).not.toContain('reserved')
  })

  it('rejects invalid timezone with 400 INVALID_INPUT', async () => {
    const req = importRequest({
      timezone: 'Mars/Phobos',
      file: new File(['[]'], 'empty.json', { type: 'application/json' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.message).toContain('timezone')
  })
})
