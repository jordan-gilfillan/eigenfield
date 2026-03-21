import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../db'
import { InvalidInputError } from '../../errors'
import {
  assignManagedPromptDefault,
  createManagedPromptVersion,
} from '../prompt-management'
import {
  resolveDefaultSummarizePromptVersion,
  resolvePromptDefault,
} from '../prompt-version-defaults'

describe('prompt management services', () => {
  const createdPromptIds: string[] = []
  let uniqueId: string

  beforeEach(() => {
    uniqueId = `prompt-mgmt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({
      where: {
        promptId: { in: createdPromptIds },
      },
    })
    await prisma.prompt.deleteMany({
      where: {
        id: { in: createdPromptIds },
      },
    })
    createdPromptIds.length = 0
  })

  it('resolveDefaultSummarizePromptVersion ignores stray active summarize prompts', async () => {
    const customPrompt = await prisma.prompt.create({
      data: {
        stage: 'SUMMARIZE',
        name: `custom-summarizer-${uniqueId}`,
      },
    })
    createdPromptIds.push(customPrompt.id)

    await prisma.promptVersion.create({
      data: {
        promptId: customPrompt.id,
        versionLabel: 'v99',
        templateText: 'Custom summarize prompt',
        isActive: true,
        createdAt: new Date('2099-01-01T00:00:00Z'),
      },
    })

    const promptVersion = await resolveDefaultSummarizePromptVersion()
    expect(promptVersion.prompt.name).toBe('default-summarizer')
  })

  it('resolvePromptDefault fails closed when a slot is unassigned', async () => {
    await expect(resolvePromptDefault('REDACT')).rejects.toThrow('Prompt default is not configured')
  })

  it('rejects assigning implicit defaults to custom prompt families', async () => {
    const customPrompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `custom-classifier-${uniqueId}`,
      },
    })
    createdPromptIds.push(customPrompt.id)

    const version = await prisma.promptVersion.create({
      data: {
        promptId: customPrompt.id,
        versionLabel: 'real-v1',
        templateText: 'Return JSON with category and confidence.',
        isActive: true,
      },
    })

    await expect(
      assignManagedPromptDefault({
        slot: 'CLASSIFY_REAL',
        promptVersionId: version.id,
      }),
    ).rejects.toThrow(InvalidInputError)
  })

  it('creates and activates a new prompt version within a family', async () => {
    const prompt = await prisma.prompt.create({
      data: {
        stage: 'CLASSIFY',
        name: `family-${uniqueId}`,
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

    const promptFamily = await createManagedPromptVersion({
      promptId: prompt.id,
      versionLabel: 'v2',
      templateText: 'Return ONLY JSON with category and confidence.',
      activate: true,
    })

    expect(promptFamily.activeVersionId).toBe(
      promptFamily.versions.find((version) => version.versionLabel === 'v2')?.id,
    )
    expect(promptFamily.versions.find((version) => version.versionLabel === 'v2')?.isActive).toBe(true)
    expect(promptFamily.versions.find((version) => version.versionLabel === 'v1')?.isActive).toBe(false)
  })
})
