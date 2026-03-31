import type { PromptDefaultSlot, PromptVersion, Prompt, Stage } from '@prisma/client'
import {
  PROMPT_DEFAULT_SLOT_VALUES,
  type PromptCompatibilityMap,
  type PromptDefaultSlotApi,
  type PromptSlotCompatibility,
} from './types/prompt-management'
import {
  ALL_CLASSIFY_CATEGORIES,
  CANONICAL_PROMPT_NAMES,
  DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS,
  getSeededCanonicalPromptTemplate,
} from './canonical-prompts'

export { CANONICAL_PROMPT_NAMES, DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS } from './canonical-prompts'

type PromptIdentity = Pick<Prompt, 'id' | 'stage' | 'name'>

export type PromptVersionWithPrompt = Pick<
  PromptVersion,
  'id' | 'promptId' | 'versionLabel' | 'templateText' | 'createdAt' | 'isActive'
> & {
  prompt: PromptIdentity
}

export const DEFAULT_CLASSIFY_PROMPT_NAME = CANONICAL_PROMPT_NAMES.CLASSIFY

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

function normalizePromptText(templateText: string): string {
  return templateText.toLowerCase().replace(/\s+/g, ' ').trim()
}

function validateSeededTemplateIntegrity(
  promptVersion: PromptVersionWithPrompt,
): PromptSlotCompatibility {
  const seededTemplate = getSeededCanonicalPromptTemplate(
    promptVersion.prompt.stage,
    promptVersion.prompt.name,
    promptVersion.versionLabel,
  )

  if (!seededTemplate) {
    return { valid: true, reasons: [], notes: [] }
  }

  if (promptVersion.templateText === seededTemplate) {
    return {
      valid: true,
      reasons: [],
      notes: ['Matches the seeded canonical prompt text'],
    }
  }

  return {
    valid: false,
    reasons: [
      'Seeded canonical prompt text has drifted from the repo baseline. Run `npm run db:seed` or assign a different compatible version.',
    ],
    notes: [],
  }
}

function validateJsonOnlyInstructions(normalizedTemplate: string): string[] {
  const reasons: string[] = []
  if (!normalizedTemplate.includes('json')) {
    reasons.push('Missing JSON output instruction')
    return reasons
  }

  const hasJsonOnlyConstraint =
    /(?:return|respond|output)[^.\n]{0,120}json/.test(normalizedTemplate) &&
    /(?:only|no prose|no explanation|no text outside|no code fences)/.test(normalizedTemplate)

  if (!hasJsonOnlyConstraint) {
    reasons.push('Missing JSON-only response instruction')
  }

  return reasons
}

export function validateClassifyRealTemplate(templateText: string): PromptSlotCompatibility {
  const normalized = normalizePromptText(templateText)
  const reasons: string[] = []

  reasons.push(...validateJsonOnlyInstructions(normalized))

  if (!normalized.includes('"category"') && !normalized.includes('category must')) {
    reasons.push('Missing "category" output constraint')
  }
  if (!normalized.includes('"confidence"') && !normalized.includes('confidence must')) {
    reasons.push('Missing "confidence" output constraint')
  }
  const missingCategories = ALL_CLASSIFY_CATEGORIES.filter(
    (category) => !normalized.includes(category.toLowerCase()),
  )
  if (missingCategories.length > 0) {
    reasons.push('Missing allowed classify category taxonomy')
  }

  return {
    valid: reasons.length === 0,
    reasons,
    notes:
      reasons.length === 0
        ? ['Suitable for real classify JSON output and closed-set category parsing']
        : [],
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
  const seededIntegrity = validateSeededTemplateIntegrity(promptVersion)
  const mergedNotes = [...seededIntegrity.notes]

  switch (slot) {
    case 'CLASSIFY_REAL': {
      if (promptVersion.versionLabel === DEFAULT_CLASSIFY_PROMPT_VERSION_LABELS.stub) {
        return {
          valid: false,
          reasons: ['Stub classify prompt cannot be used as a real classify prompt'],
          notes: mergedNotes,
        }
      }

      const structural = validateClassifyRealTemplate(trimmedTemplate)
      return {
        valid: structural.valid && seededIntegrity.valid,
        reasons: [...seededIntegrity.reasons, ...structural.reasons],
        notes: [...mergedNotes, ...structural.notes],
      }
    }
    case 'CLASSIFY_STUB':
      return {
        valid: seededIntegrity.valid,
        reasons: seededIntegrity.reasons,
        notes: [
          ...mergedNotes,
          'Stub mode ignores template text; this version is for audit/default tracking only',
        ],
      }
    case 'SUMMARIZE':
    case 'REDACT':
      return trimmedTemplate.length > 0
        ? { valid: seededIntegrity.valid, reasons: seededIntegrity.reasons, notes: mergedNotes }
        : { valid: false, reasons: ['Template text must be non-empty'], notes: mergedNotes }
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
