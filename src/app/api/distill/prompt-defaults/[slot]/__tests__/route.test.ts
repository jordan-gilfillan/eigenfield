import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/db'

function makeRequest(slot: string, body: Record<string, unknown>) {
  return POST(
    new NextRequest(`http://localhost/api/distill/prompt-defaults/${slot}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ slot }) },
  )
}

describe('POST /api/distill/prompt-defaults/:slot', () => {
  let promptId: string

  beforeEach(async () => {
    const prompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `custom-default-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    })
    promptId = prompt.id
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({ where: { promptId } })
    await prisma.prompt.deleteMany({ where: { id: promptId } })
  })

  it('rejects custom prompt families as implicit real classify defaults', async () => {
    const promptVersion = await prisma.promptVersion.create({
      data: {
        promptId,
        versionLabel: 'v1',
        templateText: 'Return JSON with category and confidence.',
        isActive: true,
      },
    })

    const res = await makeRequest('CLASSIFY_REAL', { promptVersionId: promptVersion.id })
    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error.code).toBe('INVALID_INPUT')
    expect(json.error.message).toContain('canonical')
  })
})
