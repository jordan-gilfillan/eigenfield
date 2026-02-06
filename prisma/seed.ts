/**
 * Prisma seed script
 *
 * MUST be idempotent: running multiple times produces the same result
 * without errors or duplicates.
 *
 * Seeds:
 * - FilterProfiles: professional-only, professional-plus-creative, safety-exclude
 * - Prompts: classify, summarize, redact
 * - PromptVersions: classify_stub_v1 (active for classify), summarize_v1 (active), redact_v1 (inactive)
 */

import { PrismaClient } from '@prisma/client'

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
    where: { stage_name: { stage: 'CLASSIFY', name: 'default-classifier' } },
    update: {},
    create: {
      stage: 'CLASSIFY',
      name: 'default-classifier',
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
    update: { isActive: true },
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_stub_v1',
      templateText: 'STUB: Deterministic classification based on atomStableId hash. See spec 7.2.',
      isActive: true,
    },
  })
  console.log(`    PromptVersion: classify_stub_v1 (active)`)

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1',
      },
    },
    update: {},
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_real_v1',
      templateText: `You are a message classifier. Classify the following AI conversation message into exactly one category.

Categories: WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER, MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL, EMBARRASSING

Respond with ONLY a JSON object, no other text:
{"category":"<CATEGORY>","confidence":<0.0-1.0>}

Rules:
- category MUST be one of the listed categories (uppercase, exact match)
- confidence MUST be a number between 0.0 and 1.0
- Do NOT include any explanation or text outside the JSON object`,
      isActive: false,
    },
  })
  console.log(`    PromptVersion: classify_real_v1 (inactive)`)

  // Summarize prompt with placeholder version
  const summarizePrompt = await prisma.prompt.upsert({
    where: { stage_name: { stage: 'SUMMARIZE', name: 'default-summarizer' } },
    update: {},
    create: {
      stage: 'SUMMARIZE',
      name: 'default-summarizer',
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
    update: { isActive: true },
    create: {
      promptId: summarizePrompt.id,
      versionLabel: 'v1',
      templateText: `You are summarizing a day's worth of AI conversation messages.

Input format:
# SOURCE: <source>
[<timestamp>] <role>: <message>

Produce a concise summary capturing:
1. Key topics discussed
2. Decisions made or conclusions reached
3. Action items or follow-ups mentioned

Output as markdown with clear headings.`,
      isActive: true,
    },
  })
  console.log(`    PromptVersion: v1 (active)`)

  // Redact prompt with placeholder version (not active in v0.3)
  const redactPrompt = await prisma.prompt.upsert({
    where: { stage_name: { stage: 'REDACT', name: 'default-redactor' } },
    update: {},
    create: {
      stage: 'REDACT',
      name: 'default-redactor',
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
    update: { isActive: false },
    create: {
      promptId: redactPrompt.id,
      versionLabel: 'v1',
      templateText: 'PLACEHOLDER: Redaction prompt for future use.',
      isActive: false,
    },
  })
  console.log(`    PromptVersion: v1 (inactive)`)

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
