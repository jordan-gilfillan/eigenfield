import { describe, expect, it } from 'vitest'
import {
  CANONICAL_PROMPT_NAMES,
  CANONICAL_PROMPT_TEMPLATES,
} from '../canonical-prompts'
import {
  getPromptSlotCompatibility,
  validateClassifyRealTemplate,
  type PromptVersionWithPrompt,
} from '../prompt-metadata'

function makePromptVersion(options: {
  stage: 'CLASSIFY' | 'SUMMARIZE' | 'REDACT'
  promptName: string
  versionLabel: string
  templateText: string
}): PromptVersionWithPrompt {
  return {
    id: `pv-${options.versionLabel}`,
    promptId: `prompt-${options.promptName}`,
    versionLabel: options.versionLabel,
    templateText: options.templateText,
    createdAt: new Date('2026-03-30T00:00:00Z'),
    isActive: false,
    prompt: {
      id: `prompt-${options.promptName}`,
      stage: options.stage,
      name: options.promptName,
    },
  }
}

describe('prompt metadata compatibility', () => {
  it('accepts the seeded canonical real classify template', () => {
    const compatibility = validateClassifyRealTemplate(
      CANONICAL_PROMPT_TEMPLATES.CLASSIFY['default-classifier'].classify_real_v1,
    )

    expect(compatibility.valid).toBe(true)
  })

  it('rejects placeholder real classify prompts without the allowed taxonomy', () => {
    const compatibility = validateClassifyRealTemplate(
      'Return ONLY JSON with category and confidence.',
    )

    expect(compatibility.valid).toBe(false)
    expect(compatibility.reasons).toContain('Missing allowed classify category taxonomy')
  })

  it('rejects placeholder real classify prompts that do not require JSON-only output', () => {
    const compatibility = validateClassifyRealTemplate(
      'Respond with JSON: {"category":"<CAT>","confidence":<0-1>}',
    )

    expect(compatibility.valid).toBe(false)
    expect(compatibility.reasons).toContain('Missing JSON-only response instruction')
    expect(compatibility.reasons).toContain('Missing allowed classify category taxonomy')
  })

  it('flags drifted seeded classify stub versions for the CLASSIFY_STUB slot', () => {
    const compatibility = getPromptSlotCompatibility(
      makePromptVersion({
        stage: 'CLASSIFY',
        promptName: CANONICAL_PROMPT_NAMES.CLASSIFY,
        versionLabel: 'classify_stub_v1',
        templateText: 'STUB: Deterministic classification based on atomStableId hash.',
      }),
      'CLASSIFY_STUB',
    )

    expect(compatibility.valid).toBe(false)
    expect(compatibility.reasons[0]).toContain('Run `npm run db:seed`')
  })

  it('flags drifted seeded summarize defaults for the SUMMARIZE slot', () => {
    const compatibility = getPromptSlotCompatibility(
      makePromptVersion({
        stage: 'SUMMARIZE',
        promptName: CANONICAL_PROMPT_NAMES.SUMMARIZE,
        versionLabel: 'v1',
        templateText: 'Default summarize prompt',
      }),
      'SUMMARIZE',
    )

    expect(compatibility.valid).toBe(false)
    expect(compatibility.reasons[0]).toContain('Run `npm run db:seed`')
  })

  it('keeps custom summarize versions valid when non-empty', () => {
    const compatibility = getPromptSlotCompatibility(
      makePromptVersion({
        stage: 'SUMMARIZE',
        promptName: CANONICAL_PROMPT_NAMES.SUMMARIZE,
        versionLabel: 'custom-v2',
        templateText: 'Summarize the selected day in markdown.',
      }),
      'SUMMARIZE',
    )

    expect(compatibility.valid).toBe(true)
  })
})
