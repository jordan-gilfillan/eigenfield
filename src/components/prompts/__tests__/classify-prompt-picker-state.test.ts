import { describe, expect, it } from 'vitest'
import type { ManagedPromptFamily, ManagedPromptVersion, PromptCompatibilityMap } from '@/lib/types/prompt-management'
import {
  canApplyPromptPreview,
  getPreferredPromptFamilyId,
  getPromptVersionForDisplay,
  hasPendingPromptSelection,
} from '../classify-prompt-picker-state'

function makeCompatibilityMap(validReal = true): PromptCompatibilityMap {
  return {
    CLASSIFY_STUB: { valid: true, reasons: [], notes: ['Stub mode ignores template semantics.'] },
    CLASSIFY_REAL: {
      valid: validReal,
      reasons: validReal ? [] : ['Prompt must constrain output to JSON with category and confidence.'],
      notes: [],
    },
    SUMMARIZE: { valid: true, reasons: [], notes: [] },
    REDACT: { valid: true, reasons: [], notes: [] },
  }
}

function makeVersion(options: {
  id: string
  versionLabel: string
  promptId?: string
  promptName?: string
  templateText?: string
  validReal?: boolean
}): ManagedPromptVersion {
  const promptId = options.promptId ?? 'prompt-default'
  return {
    id: options.id,
    versionLabel: options.versionLabel,
    createdAt: '2026-03-21T12:00:00.000Z',
    isActive: options.id === 'v1',
    defaultSlots: options.id === 'v1' ? ['CLASSIFY_REAL'] : [],
    compatibility: makeCompatibilityMap(options.validReal),
    prompt: {
      id: promptId,
      stage: 'CLASSIFY',
      name: options.promptName ?? 'default-classifier',
    },
    templateText: options.templateText ?? `Prompt body for ${options.versionLabel}`,
  }
}

describe('classify prompt picker state helpers', () => {
  it('prefers the committed prompt family before default-slot families', () => {
    const currentValue = makeVersion({
      id: 'current',
      versionLabel: 'current_v1',
      promptId: 'prompt-current',
      promptName: 'custom-family',
    })

    const defaultFamily: ManagedPromptFamily = {
      id: 'prompt-default',
      stage: 'CLASSIFY',
      name: 'default-classifier',
      isCanonical: true,
      activeVersionId: 'v1',
      defaultSlots: ['CLASSIFY_REAL'],
      versions: [makeVersion({ id: 'v1', versionLabel: 'classify_real_v1' })],
    }

    const currentFamily: ManagedPromptFamily = {
      id: 'prompt-current',
      stage: 'CLASSIFY',
      name: 'custom-family',
      isCanonical: false,
      activeVersionId: 'current',
      defaultSlots: [],
      versions: [currentValue],
    }

    expect(
      getPreferredPromptFamilyId({
        families: [defaultFamily, currentFamily],
        slot: 'CLASSIFY_REAL',
        value: currentValue,
      }),
    ).toBe('prompt-current')
  })

  it('previews another version without changing the committed selection', () => {
    const currentValue = makeVersion({ id: 'v1', versionLabel: 'classify_real_v1' })
    const previewCandidate = makeVersion({ id: 'v2', versionLabel: 'classify_real_v2' })
    const family: ManagedPromptFamily = {
      id: 'prompt-default',
      stage: 'CLASSIFY',
      name: 'default-classifier',
      isCanonical: true,
      activeVersionId: 'v1',
      defaultSlots: ['CLASSIFY_REAL'],
      versions: [currentValue, previewCandidate],
    }

    const previewVersion = getPromptVersionForDisplay({
      family,
      previewVersionId: 'v2',
      value: currentValue,
    })

    expect(currentValue.id).toBe('v1')
    expect(previewVersion?.id).toBe('v2')
    expect(
      hasPendingPromptSelection({
        value: currentValue,
        previewVersion,
      }),
    ).toBe(true)
    expect(
      canApplyPromptPreview({
        slot: 'CLASSIFY_REAL',
        value: currentValue,
        previewVersion,
      }),
    ).toBe(true)
  })

  it('blocks applying an incompatible preview version', () => {
    const currentValue = makeVersion({ id: 'v1', versionLabel: 'classify_real_v1' })
    const incompatiblePreview = makeVersion({
      id: 'bad-v2',
      versionLabel: 'classify_real_v2',
      validReal: false,
    })

    expect(
      canApplyPromptPreview({
        slot: 'CLASSIFY_REAL',
        value: currentValue,
        previewVersion: incompatiblePreview,
      }),
    ).toBe(false)
  })
})
