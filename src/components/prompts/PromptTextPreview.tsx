import React, { type ReactNode } from 'react'

interface PromptTextPreviewProps {
  title?: string
  description?: string
  templateText?: string | null
  emptyMessage?: string
  actions?: ReactNode
}

export function PromptTextPreview({
  title = 'Prompt text',
  description,
  templateText,
  emptyMessage = 'Template text unavailable.',
  actions,
}: PromptTextPreviewProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{title}</p>
          {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100 whitespace-pre-wrap">
        {templateText || emptyMessage}
      </pre>
    </div>
  )
}
