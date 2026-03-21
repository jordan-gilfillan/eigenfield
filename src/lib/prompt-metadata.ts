import type { PromptDefaultSlot, PromptVersion, Prompt, Stage } from '@prisma/client'
import {
  PROMPT_DEFAULT_SLOT_VALUES,
  type PromptCompatibilityMap,
  type PromptDefaultSlotApi,
  type PromptSlotCompatibility,
} from './types/prompt-management'

type PromptIdentity = Pick<Prompt, 'id' | 'stage' | 'name'>

export type PromptVersionWithPrompt = Pick<
  PromptVersion,
  'id' | 'promptId' | 'versionLabel' | 'templateText' | 'createdAt' | 'isActive'
> & {
  prompt: PromptIdentity
}

export const CANONICAL_PROMPT_NAMES = {
  CLASSIFY: 'default-classifier',
  SUMMARIZE: 'default-summarizer',
  REDACT: 'default-redactor',
} as const satisfies Record<Stage, string>

export const DEFAULT_CLASSIFY_PROMPT_NAME = CANONICAL_PROMPT_NAMES.CLASSIFY

export const DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS = {
  stub: 'classify_stub_v1',
  real: 'classify_real_v1',
} as const

export function getCanonicalPromptNameForStage(stage: Stage): string {
  return CANONICAL_PROMPT_NAMES[stage]
}

export function getCanonicalPromptNameForSlot(slot: PromptDefaultSlot | PromptDefaultSlotApi): string {
  switch (slot) {
    case 'CLASSIFY_STUB':
    case 'CLASSIFY_REAL':
      return CANONICAL_PROMPT_NAMES.CLASSIFY
    case 'SUMMARIZE':
      return CANONICAL_PROMPT_NAMES.SUMMARIZE
    case 'REDACT':
      return CANONICAL_PROMPT_NAMES.REDACT
  }
}

export function getStageForSlot(slot: PromptDefaultSlot | PromptDefaultSlotApi): Stage {
  switch (slot) {
    case 'CLASSIFY_STUB':
    case 'CLASSIFY_REAL':
      return 'CLASSIFY'
    case 'SUMMARIZE':
      return 'SUMMARIZE'
    case 'REDACT':
      return 'REDACT'
  }
}

export function isCanonicalPrompt(prompt: Pick<Prompt, 'stage' | 'name'>): boolean {
  return prompt.name === getCanonicalPromptNameForStage(prompt.stage)
}

export function isCanonicalPromptForSlot(
  prompt: Pick<Prompt, 'stage' | 'name'>,
  slot: PromptDefaultSlot | PromptDefaultSlotApi,
): boolean {
  return prompt.stage === getStageForSlot(slot) && prompt.name === getCanonicalPromptNameForSlot(slot)
}

export function validateClassifyRealTemplate(templateText: string): PromptSlotCompatibility {
  const normalized = templateText.toLowerCase()
  const reasons: string[] = []
  if (!normalized.includes('category')) {
    reasons.push('Missing "category" output constraint')
  }
  if (!normalized.includes('confidence')) {
    reasons.push('Missing "confidence" output constraint')
  }
  return {
    valid: reasons.length === 0,
    reasons,
    notes: reasons.length === 0 ? ['Suitable for real classify JSON output'] : [],
  }
}

export function getPromptSlotCompatibility(
  promptVersion: PromptVersionWithPrompt,
  slot: PromptDefaultSlot | PromptDefaultSlotApi,
): PromptSlotCompatibility {
  const expectedStage = getStageForSlot(slot)
  if (promptVersion.prompt.stage !== expectedStage) {
    return {
      valid: false,
      reasons: [`Expected ${expectedStage} stage, got ${promptVersion.prompt.stage}`],
      notes: [],
    }
  }

  const trimmedTemplate = promptVersion.templateText.trim()

  switch (slot) {
    case 'CLASSIFY_REAL':
      return validateClassifyRealTemplate(trimmedTemplate)
    case 'CLASSIFY_STUB':
      return {
        valid: true,
        reasons: [],
        notes: ['Stub mode ignores template text; this version is for audit/default tracking only'],
      }
    case 'SUMMARIZE':
    case 'REDACT':
      return trimmedTemplate.length > 0
        ? { valid: true, reasons: [], notes: [] }
        : { valid: false, reasons: ['Template text must be non-empty'], notes: [] }
  }
}

export function getPromptCompatibilityMap(promptVersion: PromptVersionWithPrompt): PromptCompatibilityMap {
  const entries = PROMPT_DEFAULT_SLOT_VALUES.map((slot) => [
    slot,
    getPromptSlotCompatibility(promptVersion, slot),
  ]) as Array<[PromptDefaultSlotApi, PromptSlotCompatibility]>

  return Object.fromEntries(entries) as PromptCompatibilityMap
}

export function toPromptDefaultSlotApi(slot: PromptDefaultSlot): PromptDefaultSlotApi {
  return slot
}

export function getPromptTemplatePreview(templateText: string, maxLength = 180): string {
  const collapsed = templateText.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, maxLength - 1)}…`
}
