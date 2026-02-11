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
 * Invariant: at most one active PromptVersion per stage (SPEC §6.7).
 * v0.3: redact has 0 active (stage not yet implemented).
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
    update: { isActive: false },
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_stub_v1',
      templateText: 'STUB: Deterministic classification based on atomStableId hash. See spec 7.2.',
      isActive: false,
    },
  })
  console.log(`    PromptVersion: classify_stub_v1 (inactive)`)

  await prisma.promptVersion.upsert({
    where: {
      promptId_versionLabel: {
        promptId: classifyPrompt.id,
        versionLabel: 'classify_real_v1',
      },
    },
    update: { isActive: true },
    create: {
      promptId: classifyPrompt.id,
      versionLabel: 'classify_real_v1',
      templateText: `You are a message classifier. Classify the following AI conversation message into exactly one category.

Categories: WORK, LEARNING, CREATIVE, MUNDANE, PERSONAL, OTHER, MEDICAL, MENTAL_HEALTH, ADDICTION_RECOVERY, INTIMACY, FINANCIAL, LEGAL, EMBARRASSING

Return ONLY a JSON object. No prose. No code fences.
Example output:
{"category":"WORK","confidence":0.72}

Rules:
- category MUST be one of the listed categories (uppercase, exact match)
- confidence MUST be a number between 0.0 and 1.0
- Never invent new categories. If uncertain, choose the closest category from the allowed list.
- Do NOT include any explanation or text outside the JSON object`,
      isActive: true,
    },
  })
  console.log(`    PromptVersion: classify_real_v1 (active)`)

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

  // Journal-friendly summarize prompt versions (all inactive)
  const journalVersions = [
    {
      versionLabel: 'journal_v1',
      templateText: `You are writing a personal journal entry summarizing a day of AI conversations.

Write in first person, past tense. Be warm and reflective — like someone writing in their own journal at the end of the day.

Structure your entry as:

1. A narrative opening (2–3 sentences) capturing what the day was about
2. **Key moments** — 3–5 bullet points of notable topics, decisions, or realizations
3. **Reflections** — 1–2 sentences on patterns, themes, or lingering questions

Guidelines:
- Write as if the person is reading their own journal months later
- Focus on what mattered, not what was trivial
- Keep it under 300 words
- Use markdown formatting

Do NOT use any of the following:
- Report-style headings like "Summary", "Overview", "Key Topics Discussed", "Conclusions", "Action Items", "Executive Summary"
- Corporate/formal tone ("deliverables", "stakeholders", "action items", "follow-ups", "next steps")
- Third-person voice or passive constructions ("It was discussed that...", "The user explored...")
- Meta-commentary about the summarization process ("This summary covers...", "The conversations included...")`,
    },
    {
      versionLabel: 'journal_v2',
      templateText: `You are distilling a day of AI conversations into a concise journal entry.

Write for someone reviewing their own day. Be direct, warm, and honest.

Structure:

**Today** — 3–5 bullet points: what was explored, decided, or created
**Open threads** — Anything unfinished or worth revisiting (1–3 bullets, or "None" if nothing stood out)
**Closing** — One sentence capturing the day's energy or direction

Guidelines:
- Skip pleasantries and meta-commentary
- Under 200 words
- Markdown formatting

Do NOT use any of the following:
- Report-style headings like "Summary", "Overview", "Key Topics", "Conclusions", "Action Items"
- Corporate/formal tone ("deliverables", "stakeholders", "action items", "follow-ups", "next steps")
- Third-person voice ("The user discussed...", "Topics covered include...")
- Filler phrases ("In this conversation...", "Throughout the day...", "Various topics were explored...")`,
    },
    {
      versionLabel: 'journal_v3',
      templateText: `You are writing a reflective journal entry from a day of AI conversations.

Write a single flowing paragraph (150–250 words) in first person, past tense.
Capture what was on the person's mind, what they explored, and where their thinking landed by end of day.

No bullet points. No headings. No structure beyond the paragraph itself. Just honest, readable prose — like a diary entry someone would actually want to re-read.

Do NOT use any of the following:
- Report-style language ("Summary", "Overview", "Key Topics", "Action Items")
- Corporate/formal tone ("deliverables", "stakeholders", "next steps", "follow-ups")
- Third-person voice or passive constructions
- Opening with "Today, I..." — vary the opening
- Meta-commentary about summarization ("This entry covers...", "The conversations touched on...")`,
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

  // ==========================================================================
  // Invariant check: exactly one active PromptVersion per stage (SPEC §6.7)
  // ==========================================================================

  const stages = ['CLASSIFY', 'SUMMARIZE', 'REDACT'] as const
  for (const stage of stages) {
    const activeCount = await prisma.promptVersion.count({
      where: {
        isActive: true,
        prompt: { stage },
      },
    })
    if (activeCount > 1) {
      throw new Error(
        `Invariant violated: stage ${stage} has ${activeCount} active PromptVersions (expected at most 1)`
      )
    }
    console.log(`  Invariant OK: ${stage} has ${activeCount} active PromptVersion(s)`)
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
