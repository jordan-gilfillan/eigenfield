import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

function searchRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/distill/search')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url)
}

describe('GET /api/distill/search', () => {
  it('rejects invalid startDate with 400 INVALID_INPUT', async () => {
    const res = await GET(searchRequest({
      q: 'hello',
      scope: 'raw',
      startDate: '2024-13-01',
    }))
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('startDate')
  })

  it('rejects invalid endDate with 400 INVALID_INPUT', async () => {
    const res = await GET(searchRequest({
      q: 'hello',
      scope: 'raw',
      endDate: '2024-02-30',
    }))
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('endDate')
  })
})

