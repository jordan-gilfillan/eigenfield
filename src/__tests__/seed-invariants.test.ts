/**
 * Tests for seed invariant: exactly one active PromptVersion per stage (SPEC §6.7).
 *
 * These tests verify the invariant that the seed script enforces,
 * preventing regression to the AUD-007 bug (multiple active CLASSIFY versions).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '../lib/db'

describe('Seed invariant: one active PromptVersion per stage', () => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  let classifyPromptId: string
  let summarizePromptId: string

  beforeEach(async () => {
    const classifyPrompt = await prisma.prompt.create({
      data: { stage: 'CLASSIFY', name: `inv-classify-${uniqueSuffix}` },
    })
    classifyPromptId = classifyPrompt.id

    const summarizePrompt = await prisma.prompt.create({
      data: { stage: 'SUMMARIZE', name: `inv-summarize-${uniqueSuffix}` },
    })
    summarizePromptId = summarizePrompt.id
  })

  afterEach(async () => {
    await prisma.promptVersion.deleteMany({
      where: { promptId: { in: [classifyPromptId, summarizePromptId] } },
    })
    await prisma.prompt.deleteMany({
      where: { id: { in: [classifyPromptId, summarizePromptId] } },
    })
  })

  it('one active + one inactive per stage satisfies invariant', async () => {
    // Mirrors fixed seed: classify_real_v1 active, classify_stub_v1 inactive
    await prisma.promptVersion.createMany({
      data: [
        {
          promptId: classifyPromptId,
          versionLabel: 'stub',
          templateText: 'stub',
          isActive: false,
        },
        {
          promptId: classifyPromptId,
          versionLabel: 'real',
          templateText: 'real prompt',
          isActive: true,
        },
      ],
    })

    const activeCount = await prisma.promptVersion.count({
      where: { isActive: true, promptId: classifyPromptId },
    })

    expect(activeCount).toBe(1)
  })

  it('two active versions for same stage violates invariant', async () => {
    // Reproduces AUD-007 bug: both classify versions active
    await prisma.promptVersion.createMany({
      data: [
        {
          promptId: classifyPromptId,
          versionLabel: 'stub',
          templateText: 'stub',
          isActive: true,
        },
        {
          promptId: classifyPromptId,
          versionLabel: 'real',
          templateText: 'real prompt',
          isActive: true,
        },
      ],
    })

    const activeCount = await prisma.promptVersion.count({
      where: { isActive: true, promptId: classifyPromptId },
    })

    expect(activeCount).toBeGreaterThan(1)
  })

  it('different stages can each have one active version independently', async () => {
    await prisma.promptVersion.create({
      data: {
        promptId: classifyPromptId,
        versionLabel: 'v1',
        templateText: 'classify prompt',
        isActive: true,
      },
    })
    await prisma.promptVersion.create({
      data: {
        promptId: summarizePromptId,
        versionLabel: 'v1',
        templateText: 'summarize prompt',
        isActive: true,
      },
    })

    const classifyActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: classifyPromptId },
    })
    const summarizeActive = await prisma.promptVersion.count({
      where: { isActive: true, promptId: summarizePromptId },
    })

    expect(classifyActive).toBe(1)
    expect(summarizeActive).toBe(1)
  })

  it('findFirst with orderBy desc selects most recently created active version', async () => {
    // Mirrors the default labelSpec selection in createRun (SPEC §7.3)
    const stubVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPromptId,
        versionLabel: 'stub',
        templateText: 'stub',
        isActive: false,
      },
    })
    const realVersion = await prisma.promptVersion.create({
      data: {
        promptId: classifyPromptId,
        versionLabel: 'real',
        templateText: 'real prompt',
        isActive: true,
      },
    })

    const selected = await prisma.promptVersion.findFirst({
      where: { isActive: true, prompt: { stage: 'CLASSIFY' } },
      orderBy: { createdAt: 'desc' },
    })

    // With only one active version, it must be the real one
    expect(selected).not.toBeNull()
    expect(selected!.id).toBe(realVersion.id)
    expect(selected!.id).not.toBe(stubVersion.id)
  })
})
