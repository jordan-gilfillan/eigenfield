import { prisma } from '../db'
import type { PromptDefaultSlot } from '@prisma/client'
import { ConfigurationError } from '../errors'
import {
  DEFAULT_CLASSIFY_PROMPT_NAME,
  DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS,
  getPromptSlotCompatibility,
  type PromptVersionWithPrompt,
} from '../prompt-metadata'
import { toPromptDefaultSlotApi } from '../prompt-metadata'

export type DefaultClassifyPromptMode = 'stub' | 'real'

export function classifyModeToPromptDefaultSlot(mode: DefaultClassifyPromptMode): PromptDefaultSlot {
  return mode === 'stub' ? 'CLASSIFY_STUB' : 'CLASSIFY_REAL'
}

export async function resolvePromptDefault(slot: PromptDefaultSlot) {
  const promptDefault = await prisma.promptDefault.findUnique({
    where: { slot },
    include: {
      prompt: {
        select: {
          id: true,
          stage: true,
          name: true,
        },
      },
      promptVersion: {
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
      },
    },
  })

  if (!promptDefault) {
    throw new ConfigurationError(
      'Prompt default is not configured. Run `npx prisma db seed`.',
      { slot },
    )
  }

  const promptVersion = promptDefault.promptVersion as PromptVersionWithPrompt
  if (promptDefault.promptId !== promptVersion.promptId) {
    throw new ConfigurationError('Prompt default points to a mismatched prompt version.', {
      slot,
      promptId: promptDefault.promptId,
      promptVersionId: promptVersion.id,
      promptVersionPromptId: promptVersion.promptId,
    })
  }

  const compatibility = getPromptSlotCompatibility(promptVersion, slot)
  if (!compatibility.valid) {
    throw new ConfigurationError('Prompt default points to an incompatible prompt version.', {
      slot,
      promptVersionId: promptVersion.id,
      reasons: compatibility.reasons,
    })
  }

  return promptVersion
}

export async function resolveDefaultClassifyPromptVersion(mode: DefaultClassifyPromptMode) {
  return resolvePromptDefault(classifyModeToPromptDefaultSlot(mode))
}

export async function resolveDefaultSummarizePromptVersion() {
  return resolvePromptDefault('SUMMARIZE')
}

export function getLegacyCanonicalClassifyDetails(mode: DefaultClassifyPromptMode) {
  return {
    promptName: DEFAULT_CLASSIFY_PROMPT_NAME,
    versionLabel: DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS[mode],
    slot: toPromptDefaultSlotApi(classifyModeToPromptDefaultSlot(mode)),
  }
}
