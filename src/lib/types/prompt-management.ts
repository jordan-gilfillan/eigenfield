export const PROMPT_DEFAULT_SLOT_VALUES = [
  'CLASSIFY_STUB',
  'CLASSIFY_REAL',
  'SUMMARIZE',
  'REDACT',
] as const

export type PromptDefaultSlotApi = (typeof PROMPT_DEFAULT_SLOT_VALUES)[number]

export interface PromptSlotCompatibility {
  valid: boolean
  reasons: string[]
  notes: string[]
}

export type PromptCompatibilityMap = Record<PromptDefaultSlotApi, PromptSlotCompatibility>

export interface PromptInfo {
  id: string
  stage: string
  name: string
}

export interface ManagedPromptVersion {
  id: string
  versionLabel: string
  createdAt: string
  isActive: boolean
  defaultSlots: PromptDefaultSlotApi[]
  compatibility: PromptCompatibilityMap
  prompt: PromptInfo
  templateText?: string
}

export interface ManagedPromptFamily {
  id: string
  stage: string
  name: string
  isCanonical: boolean
  activeVersionId: string | null
  defaultSlots: PromptDefaultSlotApi[]
  versions: ManagedPromptVersion[]
}
