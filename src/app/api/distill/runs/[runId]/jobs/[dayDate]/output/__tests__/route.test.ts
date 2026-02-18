import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

function callOutput(runId: string, dayDate: string) {
  const req = new NextRequest(
    `http://localhost:3000/api/distill/runs/${runId}/jobs/${dayDate}/output`
  )
  return GET(req, { params: Promise.resolve({ runId, dayDate }) })
}

describe('GET /api/distill/runs/:runId/jobs/:dayDate/output', () => {
  it('rejects invalid dayDate with 400 INVALID_INPUT', async () => {
    const res = await callOutput('any-run-id', '2024-13-01')
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('dayDate')
  })
})

