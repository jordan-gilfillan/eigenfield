import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PromptTextPreview } from '../PromptTextPreview'

describe('PromptTextPreview', () => {
  it('renders a labeled prompt text preview', () => {
    const html = renderToStaticMarkup(
      <PromptTextPreview
        description="Read-only prompt body for the selected version."
        templateText="Summarize the day in first-person journal voice."
      />,
    )

    expect(html).toContain('Prompt text')
    expect(html).toContain('Read-only prompt body for the selected version.')
    expect(html).toContain('Summarize the day in first-person journal voice.')
  })
})
