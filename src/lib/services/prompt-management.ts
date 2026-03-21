import type { Prisma, PromptDefaultSlot, Stage } from '@prisma/client'
import { prisma } from '../db'
import { ConflictError, InvalidInputError, NotFoundError } from '../errors'
import {
  getPromptCompatibilityMap,
  isCanonicalPrompt,
  isCanonicalPromptForSlot,
  type PromptVersionWithPrompt,
} from '../prompt-metadata'
import type {
  ManagedPromptFamily,
  ManagedPromptVersion,
  PromptDefaultSlotApi,
} from '../types/prompt-management'

const promptFamilyInclude = {
  versions: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      promptId: true,
      versionLabel: true,
      templateText: true,
      createdAt: true,
      isActive: true,
      defaultAssignments: {
        select: { slot: true },
      },
    },
  },
  defaultAssignments: {
    select: {
      slot: true,
      promptVersionId: true,
    },
  },
} satisfies Prisma.PromptInclude

type PromptFamilyRecord = Prisma.PromptGetPayload<{
  include: typeof promptFamilyInclude
}>

type PromptVersionRecord = PromptFamilyRecord['versions'][number]

function serializePromptVersion(
  prompt: Pick<PromptFamilyRecord, 'id' | 'stage' | 'name'>,
  version: PromptVersionRecord,
  includeTemplateText: boolean,
): ManagedPromptVersion {
  const promptVersion = {
    id: version.id,
    promptId: version.promptId,
    versionLabel: version.versionLabel,
    templateText: version.templateText,
    createdAt: version.createdAt,
    isActive: version.isActive,
    prompt: {
      id: prompt.id,
      stage: prompt.stage,
      name: prompt.name,
    },
  } satisfies PromptVersionWithPrompt

  return {
    id: version.id,
    versionLabel: version.versionLabel,
    createdAt: version.createdAt.toISOString(),
    isActive: version.isActive,
    defaultSlots: version.defaultAssignments.map((item) => item.slot as PromptDefaultSlotApi),
    compatibility: getPromptCompatibilityMap(promptVersion),
    prompt: {
      id: prompt.id,
      stage: prompt.stage,
      name: prompt.name,
    },
    ...(includeTemplateText ? { templateText: version.templateText } : {}),
  }
}

function serializePromptFamily(prompt: PromptFamilyRecord, includeTemplateText: boolean): ManagedPromptFamily {
  return {
    id: prompt.id,
    stage: prompt.stage,
    name: prompt.name,
    isCanonical: isCanonicalPrompt(prompt),
    activeVersionId: prompt.versions.find((version) => version.isActive)?.id ?? null,
    defaultSlots: prompt.defaultAssignments.map((item) => item.slot as PromptDefaultSlotApi),
    versions: prompt.versions.map((version) =>
      serializePromptVersion(prompt, version, includeTemplateText),
    ),
  }
}

async function loadPromptFamilyRecord(promptId: string) {
  const prompt = await prisma.prompt.findUnique({
    where: { id: promptId },
    include: promptFamilyInclude,
  })

  if (!prompt) {
    throw new NotFoundError('Prompt', promptId)
  }

  return prompt
}

function validatePromptVersionInput(versionLabel: string, templateText: string) {
  if (!versionLabel.trim()) {
    throw new InvalidInputError('versionLabel must be non-empty')
  }
  if (!templateText.trim()) {
    throw new InvalidInputError('templateText must be non-empty')
  }
}

export async function listManagedPromptFamilies(stage?: Stage) {
  const prompts = await prisma.prompt.findMany({
    where: stage ? { stage } : undefined,
    include: promptFamilyInclude,
    orderBy: [{ stage: 'asc' }, { name: 'asc' }],
  })

  return prompts.map((prompt) => serializePromptFamily(prompt, false))
}

export async function getManagedPromptFamily(promptId: string) {
  const prompt = await loadPromptFamilyRecord(promptId)
  return serializePromptFamily(prompt, true)
}

export async function createManagedPromptVersion(options: {
  promptId: string
  versionLabel: string
  templateText: string
  activate?: boolean
}) {
  const { promptId, versionLabel, templateText, activate = false } = options
  validatePromptVersionInput(versionLabel, templateText)

  const prompt = await prisma.prompt.findUnique({
    where: { id: promptId },
    select: { id: true },
  })
  if (!prompt) {
    throw new NotFoundError('Prompt', promptId)
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (activate) {
        await tx.promptVersion.updateMany({
          where: { promptId, isActive: true },
          data: { isActive: false },
        })
      }

      await tx.promptVersion.create({
        data: {
          promptId,
          versionLabel: versionLabel.trim(),
          templateText: templateText.trim(),
          isActive: activate,
        },
      })
    })
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new ConflictError(
        'PROMPT_VERSION_EXISTS',
        `Prompt version already exists: ${versionLabel.trim()}`,
      )
    }
    throw error
  }

  return getManagedPromptFamily(promptId)
}

export async function activateManagedPromptVersion(options: {
  promptId: string
  promptVersionId: string
}) {
  const { promptId, promptVersionId } = options
  const promptVersion = await prisma.promptVersion.findUnique({
    where: { id: promptVersionId },
    select: { id: true, promptId: true },
  })

  if (!promptVersion || promptVersion.promptId !== promptId) {
    throw new NotFoundError('PromptVersion', promptVersionId)
  }

  await prisma.$transaction(async (tx) => {
    await tx.promptVersion.updateMany({
      where: { promptId, isActive: true },
      data: { isActive: false },
    })
    await tx.promptVersion.update({
      where: { id: promptVersionId },
      data: { isActive: true },
    })
  })

  return getManagedPromptFamily(promptId)
}

export async function assignManagedPromptDefault(options: {
  slot: PromptDefaultSlot
  promptVersionId: string
}) {
  const { slot, promptVersionId } = options
  const promptVersion = await prisma.promptVersion.findUnique({
    where: { id: promptVersionId },
    select: {
      id: true,
      promptId: true,
      versionLabel: true,
      templateText: true,
      createdAt: true,
      isActive: true,
      prompt: {
        select: {
          id: true,
          stage: true,
          name: true,
        },
      },
    },
  })

  if (!promptVersion) {
    throw new NotFoundError('PromptVersion', promptVersionId)
  }

  if (!isCanonicalPromptForSlot(promptVersion.prompt, slot)) {
    throw new InvalidInputError('Only canonical prompt families can own implicit default slots', {
      slot,
      promptName: promptVersion.prompt.name,
      stage: promptVersion.prompt.stage,
    })
  }

  const compatibility = getPromptCompatibilityMap(promptVersion as PromptVersionWithPrompt)[slot]
  if (!compatibility.valid) {
    throw new InvalidInputError('Prompt version is incompatible with the requested default slot', {
      slot,
      promptVersionId,
      reasons: compatibility.reasons,
    })
  }

  await prisma.promptDefault.upsert({
    where: { slot },
    update: {
      promptId: promptVersion.prompt.id,
      promptVersionId: promptVersion.id,
    },
    create: {
      slot,
      promptId: promptVersion.prompt.id,
      promptVersionId: promptVersion.id,
    },
  })

  return getManagedPromptFamily(promptVersion.prompt.id)
}
