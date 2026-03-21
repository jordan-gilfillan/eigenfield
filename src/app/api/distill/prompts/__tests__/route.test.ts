import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/db'

describe('GET /api/distill/prompts', () => {
  const createdPromptIds: string[] = []
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `prompt-route-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({
      where: { promptId: { in: createdPromptIds } },
    })
    await prisma.prompt.deleteMany({
      where: { id: { in: createdPromptIds } },
    })
    createdPromptIds.length = 0
  })

  it('returns prompt families with version metadata for a stage', async () => {
    const prompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `route-family-${uniqueId}`,
      },
    })
    createdPromptIds.push(prompt.id)

    await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionLabel: 'v1',
        templateText: 'Return JSON with category and confidence.',
        isActive: true,
      },
    })

    const res = await GET(new NextRequest('http://localhost/api/distill/prompts?stage=CLASSIFY'))
    expect(res.status).toBe(200)

    const json = await res.json()
    const item = (json.items as Array<{ name: string; versions: Array<{ compatibility: { CLASSIFY_REAL: { valid: boolean } } }> }>).find(
      (entry) => entry.name === `route-family-${uniqueId}`,
    )

    expect(item).toBeDefined()
    expect(item!.versions).toHaveLength(1)
    expect(item!.versions[0].compatibility.CLASSIFY_REAL.valid).toBe(true)
  })
})
