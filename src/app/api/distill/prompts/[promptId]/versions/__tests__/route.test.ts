import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/db'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/distill/prompts/prompt-id/versions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/distill/prompts/:promptId/versions', () => {
  let promptId: string
  let uniqueId: string

  beforeEach(async () => {
    uniqueId = `prompt-version-route-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const prompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `versions-route-${uniqueId}`,
      },
    })
    promptId = prompt.id

    await prisma.promptVersion.create({
      data: {
        promptId,
        versionLabel: 'v1',
        templateText: 'Return JSON with category and confidence.',
        isActive: true,
      },
    })
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({ where: { promptId } })
    await prisma.prompt.deleteMany({ where: { id: promptId } })
  })

  it('creates a new immutable version and activates it when requested', async () => {
    const res = await POST(
      makeRequest({
        versionLabel: 'v2',
        templateText: 'Return ONLY JSON with category and confidence.',
        activate: true,
      }),
      { params: Promise.resolve({ promptId }) },
    )

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.activeVersionId).toBe(json.versions.find((version: { versionLabel: string }) => version.versionLabel === 'v2').id)
    expect(json.versions.find((version: { versionLabel: string }) => version.versionLabel === 'v1').isActive).toBe(false)
  })
})
