import React, { type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ManagedPromptVersion, PromptCompatibilityMap } from '@/lib/types/prompt-management'
import { ClassifyPromptPicker } from '../ClassifyPromptPicker'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

function makeCompatibilityMap(): PromptCompatibilityMap {
  return {
    CLASSIFY_STUB: { valid: true, reasons: [], notes: ['Stub mode ignores template semantics.'] },
    CLASSIFY_REAL: { valid: true, reasons: [], notes: [] },
    SUMMARIZE: { valid: true, reasons: [], notes: [] },
    REDACT: { valid: true, reasons: [], notes: [] },
  }
}

function makePromptVersion(): ManagedPromptVersion {
  return {
    id: 'pv-1',
    versionLabel: 'classify_real_v1',
    createdAt: '2026-03-21T12:00:00.000Z',
    isActive: true,
    defaultSlots: ['CLASSIFY_REAL'],
    compatibility: makeCompatibilityMap(),
    prompt: {
      id: 'prompt-1',
      stage: 'CLASSIFY',
      name: 'default-classifier',
    },
    templateText: 'Return ONLY JSON with "category" and "confidence".',
  }
}

describe('ClassifyPromptPicker', () => {
  it('keeps the selected prompt text visible while collapsed', () => {
    const html = renderToStaticMarkup(
      <ClassifyPromptPicker
        mode="real"
        value={makePromptVersion()}
        onSelect={() => {}}
      />,
    )

    expect(html).toContain('Prompt text')
    expect(html).toContain('The currently selected prompt stays visible here even when the selector is collapsed.')
    expect(html).toContain('Return ONLY JSON with &quot;category&quot; and &quot;confidence&quot;.')
  })
})
