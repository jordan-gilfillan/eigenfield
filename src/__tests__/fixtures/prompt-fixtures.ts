import type { PromptDefaultSlot, Stage } from '@prisma/client'
import { prisma } from '../../lib/db'
import { CANONICAL_PROMPT_NAMES } from '../../lib/canonical-prompts'

export interface PromptDefaultSnapshot {
  slot: PromptDefaultSlot
  promptId: string
  promptVersionId: string
}

export function makeTestPromptVersionLabel(base: string): string {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function ensureCanonicalPromptFamily(stage: Stage) {
  return prisma.prompt.upsert({
    where: {
      stage_name: {
        stage,
        name: CANONICAL_PROMPT_NAMES[stage],
      },
    },
    update: {},
    create: {
      stage,
      name: CANONICAL_PROMPT_NAMES[stage],
    },
  })
}

export async function createCanonicalPromptVersionFixture(options: {
  stage: Stage
  versionLabelBase: string
  templateText: string
  isActive?: boolean
}) {
  const prompt = await ensureCanonicalPromptFamily(options.stage)
  const versionLabel = makeTestPromptVersionLabel(options.versionLabelBase)
  const promptVersion = await prisma.promptVersion.create({
    data: {
      promptId: prompt.id,
      versionLabel,
      templateText: options.templateText.trim(),
      isActive: options.isActive ?? false,
    },
  })

  return { prompt, promptVersion, versionLabel }
}

export async function capturePromptDefaultSnapshot(slot: PromptDefaultSlot): Promise<PromptDefaultSnapshot | null> {
  const row = await prisma.promptDefault.findUnique({
    where: { slot },
    select: {
      slot: true,
      promptId: true,
      promptVersionId: true,
    },
  })

  return row ?? null
}

export async function restorePromptDefaultSnapshot(snapshot: PromptDefaultSnapshot | null, slot: PromptDefaultSlot) {
  if (!snapshot) {
    await prisma.promptDefault.deleteMany({
      where: { slot },
    })
    return
  }

  await prisma.promptDefault.upsert({
    where: { slot: snapshot.slot },
    update: {
      promptId: snapshot.promptId,
      promptVersionId: snapshot.promptVersionId,
    },
    create: {
      slot: snapshot.slot,
      promptId: snapshot.promptId,
      promptVersionId: snapshot.promptVersionId,
    },
  })

  if (snapshot.slot !== slot) {
    await prisma.promptDefault.deleteMany({
      where: { slot },
    })
  }
}
