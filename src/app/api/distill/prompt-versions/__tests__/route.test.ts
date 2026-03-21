import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

async function loadRoute() {
  return import('../route')
}

describe('GET /api/distill/prompt-versions', () => {
  const createdPromptIds: string[] = []

  afterEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()

    if (createdPromptIds.length > 0) {
      await prisma.promptVersion.deleteMany({
        where: { promptId: { in: createdPromptIds } },
      })
      await prisma.prompt.deleteMany({
        where: { id: { in: createdPromptIds } },
      })
      createdPromptIds.length = 0
    }
  })

  it('returns the canonical default classify prompt version for real mode', async () => {
    const canonicalPrompt = await prisma.prompt.upsert({
      where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
      update: {},
      create: {
        stage: 'CLASSIFY',
        name: 'default-classifier',
      },
    })

    const canonicalVersion = await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: canonicalPrompt.id,
          versionLabel: 'classify_real_v1',
        },
      },
      update: {
        templateText: 'Return ONLY JSON with category and confidence.',
        isActive: true,
      },
      create: {
        promptId: canonicalPrompt.id,
        versionLabel: 'classify_real_v1',
        templateText: 'Return ONLY JSON with category and confidence.',
        isActive: true,
      },
    })

    await prisma.promptDefault.upsert({
      where: { slot: 'CLASSIFY_REAL' },
      update: {
        promptId: canonicalPrompt.id,
        promptVersionId: canonicalVersion.id,
      },
      create: {
        slot: 'CLASSIFY_REAL',
        promptId: canonicalPrompt.id,
        promptVersionId: canonicalVersion.id,
      },
    })

    const strayPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `AUD046 Classify route-test-${Date.now()}`,
      },
    })
    createdPromptIds.push(strayPrompt.id)

    await prisma.promptVersion.create({
      data: {
        promptId: strayPrompt.id,
        versionLabel: 'classify_real_v1',
        templateText: 'Stray active classify prompt',
        isActive: true,
        createdAt: new Date('2099-01-01T00:00:00Z'),
      },
    })

    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/distill/prompt-versions?stage=classify&default=true&mode=real')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.promptVersion.id).toBe(canonicalVersion.id)
    expect(body.promptVersion.versionLabel).toBe('classify_real_v1')
    expect(body.promptVersion.prompt.name).toBe('default-classifier')
    expect(body.promptVersion.templateText).toBe('Return ONLY JSON with category and confidence.')
    expect(body.promptVersion.defaultSlots).toContain('CLASSIFY_REAL')
    expect(body.promptVersion.compatibility.CLASSIFY_REAL.valid).toBe(true)
  })

  it('returns templateText when querying a singular prompt version by versionLabel', async () => {
    const prompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `prompt-version-lookup-${Date.now()}`,
      },
    })
    createdPromptIds.push(prompt.id)

    await prisma.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionLabel: 'previewable_v1',
        templateText: 'Write a concise daily narrative.',
        isActive: true,
      },
    })

    const { GET } = await loadRoute()
    const req = new NextRequest(
      'http://localhost/api/distill/prompt-versions?stage=summarize&versionLabel=previewable_v1',
    )
    const res = await GET(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.promptVersion.versionLabel).toBe('previewable_v1')
    expect(body.promptVersion.templateText).toBe('Write a concise daily narrative.')
  })

  it('rejects default=true classify requests without a mode', async () => {
    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/distill/prompt-versions?stage=classify&default=true')
    const res = await GET(req)
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  it('fails closed when canonical prompt resolution errors', async () => {
    vi.doMock('@/lib/services/prompt-version-defaults', async () => {
      const actual = await vi.importActual<typeof import('@/lib/services/prompt-version-defaults')>(
        '@/lib/services/prompt-version-defaults',
      )
      const errors = await vi.importActual<typeof import('@/lib/errors')>('@/lib/errors')
      return {
        ...actual,
        resolveDefaultClassifyPromptVersion: vi.fn(async () => {
          throw new errors.ConfigurationError('Default classify prompt version is not configured.')
        }),
      }
    })

    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost/api/distill/prompt-versions?stage=classify&default=true&mode=stub')
    const res = await GET(req)
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error.code).toBe('CONFIGURATION_ERROR')
  })
})
