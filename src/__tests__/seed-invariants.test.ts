/**
 * Tests for the seed prompt invariant: each seeded default Prompt may have at most
 * one active PromptVersion, while custom prompts may coexist without affecting seed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../lib/db'

describe('Seed invariant: one active PromptVersion per seeded default prompt', () => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let defaultClassifyPromptId: string
  let customClassifyPromptId: string
  let defaultSummarizePromptId: string

  beforeEach(async () => {
    const defaultClassifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `default-classifier-seed-test-${uniqueSuffix}` },
    })
    defaultClassifyPromptId = defaultClassifyPrompt.id

    const customClassifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `custom-classifier-seed-test-${uniqueSuffix}` },
    })
    customClassifyPromptId = customClassifyPrompt.id

    const defaultSummarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `default-summarizer-seed-test-${uniqueSuffix}` },
    })
    defaultSummarizePromptId = defaultSummarizePrompt.id
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({
      where: {
        promptId: {
          in: [defaultClassifyPromptId, customClassifyPromptId, defaultSummarizePromptId],
        },
      },
    })
    await prisma.prompt.deleteMany({
      where: {
        id: {
          in: [defaultClassifyPromptId, customClassifyPromptId, defaultSummarizePromptId],
        },
      },
    })
  })

  it('seeded default prompt can have one active and one inactive version', async () => {
    await prisma.promptVersion.createMany({
      data: [
        {
          promptId: defaultClassifyPromptId,
          versionLabel: 'stub',
          templateText: 'stub',
          isActive: false,
        },
        {
          promptId: defaultClassifyPromptId,
          versionLabel: 'real',
          templateText: 'real prompt',
          isActive: true,
        },
      ],
    })

    const activeCount = await prisma.promptVersion.count({
      where: { isActive: true, promptId: defaultClassifyPromptId },
    })

    expect(activeCount).toBe(1)
  })

  it('seeded default prompt is invalid if it has two active versions', async () => {
    await prisma.promptVersion.createMany({
      data: [
        {
          promptId: defaultClassifyPromptId,
          versionLabel: 'stub',
          templateText: 'stub',
          isActive: true,
        },
        {
          promptId: defaultClassifyPromptId,
          versionLabel: 'real',
          templateText: 'real prompt',
          isActive: true,
        },
      ],
    })

    const activeCount = await prisma.promptVersion.count({
      where: { isActive: true, promptId: defaultClassifyPromptId },
    })

    expect(activeCount).toBeGreaterThan(1)
  })

  it('custom classify prompts can be active without affecting seeded default prompt counts', async () => {
    await prisma.promptVersion.create({
      data: {
        promptId: defaultClassifyPromptId,
        versionLabel: 'seeded-real',
        templateText: 'seeded real prompt',
        isActive: true,
      },
    })
    await prisma.promptVersion.create({
      data: {
        promptId: customClassifyPromptId,
        versionLabel: 'custom-real',
        templateText: 'custom real prompt',
        isActive: true,
      },
    })

    const defaultActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: defaultClassifyPromptId },
    })
    const customActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: customClassifyPromptId },
    })

    expect(defaultActive).toBe(1)
    expect(customActive).toBe(1)
  })

  it('different seeded stages can each have one active version independently', async () => {
    await prisma.promptVersion.create({
      data: {
        promptId: defaultClassifyPromptId,
        versionLabel: 'classify-real',
        templateText: 'classify prompt',
        isActive: true,
      },
    })
    await prisma.promptVersion.create({
      data: {
        promptId: defaultSummarizePromptId,
        versionLabel: 'summarize-v1',
        templateText: 'summarize prompt',
        isActive: true,
      },
    })

    const classifyActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: defaultClassifyPromptId },
    })
    const summarizeActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: defaultSummarizePromptId },
    })

    expect(classifyActive).toBe(1)
    expect(summarizeActive).toBe(1)
  })
})
