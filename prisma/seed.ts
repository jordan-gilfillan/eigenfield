/**
 * Prisma seed script
 *
 * MUST be idempotent: running multiple times produces the same result
 * without errors or duplicates.
 *
 * Seeds:
 * - FilterProfiles: professional-only, professional-plus-creative, safety-exclude
 * - Prompts: classify, summarize, redact
 * - PromptVersions: classify_stub_v1 (inactive), classify_real_v1 (active), summarize_v1 (active),
 *   journal_v1/v2/v3 (inactive), redact_v1 (inactive)
 *
 * Invariant: at most one active PromptVersion per Prompt family (SPEC §6.7).
 * v0.3: redact has 0 active (stage not yet implemented).
 */

import { PrismaClient } from '@prisma/client'
import {
  CANONICAL_PROMPT_NAMES,
  CANONICAL_PROMPT_TEMPLATES,
} from '../src/lib/canonical-prompts'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ==========================================================================
  // FilterProfiles (Section 6.6)
  // ==========================================================================

  const filterProfiles = [
    {
      name: 'professional-only',
      mode: 'INCLUDE' as const,
      categories: ['WORK', 'LEARNING'],
    },
    {
      name: 'professional-plus-creative',
      mode: 'INCLUDE' as const,
      categories: ['WORK', 'LEARNING', 'CREATIVE'],
    },
    {
      name: 'safety-exclude',
      mode: 'EXCLUDE' as const,
      categories: [
        'MEDICAL',
        'MENTAL_HEALTH',
        'ADDICTION_RECOVERY',
        'INTIMACY',
        'FINANCIAL',
        'LEGAL',
        'EMBARRASSING',
      ],
    },
  ]

  for (const profile of filterProfiles) {
    await prisma.filterProfile.upsert({
      where: { name: profile.name },
      update: {
        mode: profile.mode,
        categories: profile.categories,
      },
      create: {
        name: profile.name,
        mode: profile.mode,
        categories: profile.categories,
      },
    })
    console.log(`  FilterProfile: ${profile.name}`)
  }

  // ==========================================================================
  // Prompts and PromptVersions (Section 6.7)
  // ==========================================================================

  // Classify prompt with stub version
  const classifyPrompt = await prisma.prompt.upsert({
    where: {
      stage_name: { stage: 'CLASSIFY', name: CANONICAL_PROMPT_NAMES.CLASSIFY },
    },
    update: {},
    create: {
      stage: 'CLASSIFY',
      name: CANONICAL_PROMPT_NAMES.CLASSIFY,
    },
  })
  console.log(`  Prompt: ${classifyPrompt.name} (${classifyPrompt.stage})`)

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_stub_v1',
      },
    },
    update: {
      isActive: false,
      templateText:
        CANONICAL_PROMPT_TEMPLATES.CLASSIFY[CANONICAL_PROMPT_NAMES.CLASSIFY].classify_stub_v1,
    },
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_stub_v1',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.CLASSIFY[CANONICAL_PROMPT_NAMES.CLASSIFY].classify_stub_v1,
      isActive: false,
    },
  })
  console.log(`    PromptVersion: classify_stub_v1 (inactive)`)

  const classifyRealTemplate =
    CANONICAL_PROMPT_TEMPLATES.CLASSIFY[CANONICAL_PROMPT_NAMES.CLASSIFY].classify_real_v1

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1',
      },
    },
    update: {
      isActive: true,
      templateText: classifyRealTemplate,
    },
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_real_v1',
      templateText: classifyRealTemplate,
      isActive: true,
    },
  })
  console.log(`    PromptVersion: classify_real_v1 (active)`)

  const classifyStubVersion = await prisma.promptVersion.findUniqueOrThrow({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_stub_v1',
      },
    },
  })

  const classifyRealVersion = await prisma.promptVersion.findUniqueOrThrow({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1',
      },
    },
  })

  // Summarize prompt with placeholder version
  const summarizePrompt = await prisma.prompt.upsert({
    where: {
      stage_name: { stage: 'SUMMARIZE', name: CANONICAL_PROMPT_NAMES.SUMMARIZE },
    },
    update: {},
    create: {
      stage: 'SUMMARIZE',
      name: CANONICAL_PROMPT_NAMES.SUMMARIZE,
    },
  })
  console.log(`  Prompt: ${summarizePrompt.name} (${summarizePrompt.stage})`)

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: summarizePrompt.id,
        versionLabel: 'v1',
      },
    },
    update: {
      isActive: true,
      templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE[CANONICAL_PROMPT_NAMES.SUMMARIZE].v1,
    },
    create: {
      promptId: summarizePrompt.id,
      versionLabel: 'v1',
      templateText: CANONICAL_PROMPT_TEMPLATES.SUMMARIZE[CANONICAL_PROMPT_NAMES.SUMMARIZE].v1,
      isActive: true,
    },
  })
  console.log(`    PromptVersion: v1 (active)`)

  const summarizeDefaultVersion = await prisma.promptVersion.findUniqueOrThrow({
    where: {
      promptId_versionLabel: {
        promptId: summarizePrompt.id,
        versionLabel: 'v1',
      },
    },
  })

  // Journal-friendly summarize prompt versions (all inactive)
  const journalVersions = [
    {
      versionLabel: 'journal_v1',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.SUMMARIZE[CANONICAL_PROMPT_NAMES.SUMMARIZE].journal_v1,
    },
    {
      versionLabel: 'journal_v2',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.SUMMARIZE[CANONICAL_PROMPT_NAMES.SUMMARIZE].journal_v2,
    },
    {
      versionLabel: 'journal_v3',
      templateText:
        CANONICAL_PROMPT_TEMPLATES.SUMMARIZE[CANONICAL_PROMPT_NAMES.SUMMARIZE].journal_v3,
    },
  ]

  for (const { versionLabel, templateText } of journalVersions) {
    await prisma.promptVersion.upsert({
      where: {
        promptId_versionLabel: {
          promptId: summarizePrompt.id,
          versionLabel,
        },
      },
      update: { templateText },
      create: {
        promptId: summarizePrompt.id,
        versionLabel,
        templateText,
        isActive: false,
      },
    })
    console.log(`    PromptVersion: ${versionLabel} (inactive)`)
  }

  // Redact prompt with placeholder version (not active in v0.3)
  const redactPrompt = await prisma.prompt.upsert({
    where: {
      stage_name: { stage: 'REDACT', name: CANONICAL_PROMPT_NAMES.REDACT },
    },
    update: {},
    create: {
      stage: 'REDACT',
      name: CANONICAL_PROMPT_NAMES.REDACT,
    },
  })
  console.log(`  Prompt: ${redactPrompt.name} (${redactPrompt.stage})`)

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: redactPrompt.id,
        versionLabel: 'v1',
      },
    },
    update: {
      isActive: false,
      templateText: CANONICAL_PROMPT_TEMPLATES.REDACT[CANONICAL_PROMPT_NAMES.REDACT].v1,
    },
    create: {
      promptId: redactPrompt.id,
      versionLabel: 'v1',
      templateText: CANONICAL_PROMPT_TEMPLATES.REDACT[CANONICAL_PROMPT_NAMES.REDACT].v1,
      isActive: false,
    },
  })
  console.log(`    PromptVersion: v1 (inactive)`)

  await prisma.promptDefault.upsert({
    where: { slot: 'CLASSIFY_STUB' },
    update: {
      promptId: classifyPrompt.id,
      promptVersionId: classifyStubVersion.id,
    },
    create: {
      slot: 'CLASSIFY_STUB',
      promptId: classifyPrompt.id,
      promptVersionId: classifyStubVersion.id,
    },
  })
  console.log(`    PromptDefault: CLASSIFY_STUB -> classify_stub_v1`)

  await prisma.promptDefault.upsert({
    where: { slot: 'CLASSIFY_REAL' },
    update: {
      promptId: classifyPrompt.id,
      promptVersionId: classifyRealVersion.id,
    },
    create: {
      slot: 'CLASSIFY_REAL',
      promptId: classifyPrompt.id,
      promptVersionId: classifyRealVersion.id,
    },
  })
  console.log(`    PromptDefault: CLASSIFY_REAL -> classify_real_v1`)

  await prisma.promptDefault.upsert({
    where: { slot: 'SUMMARIZE' },
    update: {
      promptId: summarizePrompt.id,
      promptVersionId: summarizeDefaultVersion.id,
    },
    create: {
      slot: 'SUMMARIZE',
      promptId: summarizePrompt.id,
      promptVersionId: summarizeDefaultVersion.id,
    },
  })
  console.log(`    PromptDefault: SUMMARIZE -> v1`)

  // ==========================================================================
  // Invariant checks: at most one active PromptVersion per Prompt family,
  // and canonical prompt defaults point to their owning family.
  // ==========================================================================

  const seededPrompts = [classifyPrompt, summarizePrompt, redactPrompt]
  for (const prompt of seededPrompts) {
    const activeCount = await prisma.promptVersion.count({
      where: {
        promptId: prompt.id,
        isActive: true,
      },
    })

    const label = `${prompt.stage}/${prompt.name}`
    if (activeCount > 1) {
      throw new Error(
        `Invariant violated: prompt ${label} has ${activeCount} active PromptVersions (expected at most 1)`
      )
    }
    console.log(`  Invariant OK: ${label} has ${activeCount} active PromptVersion(s)`)
  }

  const promptDefaults = await prisma.promptDefault.findMany({
    include: {
      prompt: {
        select: { id: true, stage: true, name: true },
      },
      promptVersion: {
        select: { id: true, promptId: true, versionLabel: true },
      },
    },
    orderBy: { slot: 'asc' },
  })

  for (const promptDefault of promptDefaults) {
    if (promptDefault.promptId !== promptDefault.promptVersion.promptId) {
      throw new Error(
        `Invariant violated: prompt default ${promptDefault.slot} points to mismatched prompt version ${promptDefault.promptVersion.id}`
      )
    }
    console.log(
      `  Invariant OK: ${promptDefault.slot} -> ${promptDefault.prompt.name}/${promptDefault.promptVersion.versionLabel}`
    )
  }

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
