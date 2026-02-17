import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

function callRoute(id: string, dayDate: string) {
  const req = new NextRequest(
    `http://localhost:3000/api/distill/import-batches/${id}/days/${dayDate}/atoms`
  )
  return GET(req, { params: Promise.resolve({ id, dayDate }) })
}

describe('GET /api/distill/import-batches/:id/days/:dayDate/atoms', () => {
  it('rejects invalid dayDate with 400 INVALID_INPUT', async () => {
    const res = await callRoute('any-batch-id', '2024-01-00')
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('dayDate')
  })
})

