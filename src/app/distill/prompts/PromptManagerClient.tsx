'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ManagedPromptFamily,
  PromptDefaultSlotApi,
} from '@/lib/types/prompt-management'

const STAGES = ['CLASSIFY', 'SUMMARIZE', 'REDACT'] as const

const SLOT_LABELS: Record<PromptDefaultSlotApi, string> = {
  CLASSIFY_STUB: 'Classify stub default',
  CLASSIFY_REAL: 'Classify real default',
  SUMMARIZE: 'Summarize default',
  REDACT: 'Redact default',
}

function formatApiError(data: unknown, fallback: string) {
  const apiError = data as { error?: { code?: string; message?: string } }
  const code = apiError.error?.code ? `[${apiError.error.code}] ` : ''
  return `${code}${apiError.error?.message || fallback}`
}

function defaultSlotsForStage(stage: (typeof STAGES)[number]): PromptDefaultSlotApi[] {
  switch (stage) {
    case 'CLASSIFY':
      return ['CLASSIFY_STUB', 'CLASSIFY_REAL']
    case 'SUMMARIZE':
      return ['SUMMARIZE']
    case 'REDACT':
      return ['REDACT']
  }
}

export default function PromptManagerClient() {
  const [stage, setStage] = useState<(typeof STAGES)[number]>('CLASSIFY')
  const [families, setFamilies] = useState<ManagedPromptFamily[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState(true)
  const [familiesError, setFamiliesError] = useState<string | null>(null)
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<ManagedPromptFamily | null>(null)
  const [loadingPromptDetail, setLoadingPromptDetail] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationMessage, setMutationMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [versionLabel, setVersionLabel] = useState('')
  const [templateText, setTemplateText] = useState('')
  const [activateOnCreate, setActivateOnCreate] = useState(false)

  async function loadFamilies(nextStage: (typeof STAGES)[number]) {
    setLoadingFamilies(true)
    setFamiliesError(null)
    try {
      const res = await fetch(`/api/distill/prompts?stage=${nextStage}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to load prompts (${res.status})`))
      }
      const items = ((data as { items?: ManagedPromptFamily[] }).items ?? []) as ManagedPromptFamily[]
      setFamilies(items)
      setSelectedPromptId(items[0]?.id ?? null)
    } catch (error) {
      setFamiliesError(error instanceof Error ? error.message : 'Failed to load prompts')
      setFamilies([])
      setSelectedPromptId(null)
    } finally {
      setLoadingFamilies(false)
    }
  }

  async function loadPromptDetail(promptId: string) {
    setLoadingPromptDetail(true)
    try {
      const res = await fetch(`/api/distill/prompts/${promptId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to load prompt detail (${res.status})`))
      }
      const detail = data as ManagedPromptFamily
      setSelectedPrompt(detail)
      setSelectedVersionId(detail.activeVersionId ?? detail.versions[0]?.id ?? null)
    } catch (error) {
      setFamiliesError(error instanceof Error ? error.message : 'Failed to load prompt detail')
      setSelectedPrompt(null)
      setSelectedVersionId(null)
    } finally {
      setLoadingPromptDetail(false)
    }
  }

  useEffect(() => {
    void loadFamilies(stage)
  }, [stage])

  useEffect(() => {
    if (selectedPromptId) {
      void loadPromptDetail(selectedPromptId)
    } else {
      setSelectedPrompt(null)
      setSelectedVersionId(null)
    }
  }, [selectedPromptId])

  const selectedVersion = useMemo(
    () => selectedPrompt?.versions.find((version) => version.id === selectedVersionId) ?? selectedPrompt?.versions[0] ?? null,
    [selectedPrompt, selectedVersionId],
  )

  async function refreshCurrentPrompt() {
    if (!selectedPromptId) return
    await Promise.all([loadFamilies(stage), loadPromptDetail(selectedPromptId)])
  }

  async function handleCreateVersion() {
    if (!selectedPromptId) return

    setSaving(true)
    setMutationError(null)
    setMutationMessage(null)
    try {
      const res = await fetch(`/api/distill/prompts/${selectedPromptId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          versionLabel,
          templateText,
          activate: activateOnCreate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to create prompt version (${res.status})`))
      }
      setMutationMessage('Prompt version created.')
      setVersionLabel('')
      setTemplateText('')
      setActivateOnCreate(false)
      await refreshCurrentPrompt()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to create prompt version')
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate(promptVersionId: string) {
    if (!selectedPromptId) return

    setSaving(true)
    setMutationError(null)
    setMutationMessage(null)
    try {
      const res = await fetch(`/api/distill/prompts/${selectedPromptId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptVersionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to activate prompt version (${res.status})`))
      }
      setMutationMessage('Prompt version activated.')
      await refreshCurrentPrompt()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to activate prompt version')
    } finally {
      setSaving(false)
    }
  }

  async function handleAssignDefault(slot: PromptDefaultSlotApi, promptVersionId: string) {
    setSaving(true)
    setMutationError(null)
    setMutationMessage(null)
    try {
      const res = await fetch(`/api/distill/prompt-defaults/${slot}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptVersionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to assign default (${res.status})`))
      }
      setMutationMessage(`${SLOT_LABELS[slot]} updated.`)
      await refreshCurrentPrompt()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Failed to assign default')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen max-w-7xl mx-auto p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Prompt Manager</h1>
          <p className="mt-2 text-sm text-gray-600">
            Inspect prompt families, create immutable versions, activate a family version, and manage canonical defaults.
          </p>
        </div>
      </div>

      <div className="mb-6 flex gap-2">
        {STAGES.map((stageOption) => (
          <button
            key={stageOption}
            type="button"
            onClick={() => setStage(stageOption)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              stageOption === stage
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
            }`}
          >
            {stageOption.toLowerCase()}
          </button>
        ))}
      </div>

      {familiesError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {familiesError}
        </div>
      )}

      {mutationError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {mutationError}
        </div>
      )}

      {mutationMessage && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {mutationMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Prompt Families</h2>
          <div className="mt-4 space-y-2">
            {loadingFamilies ? (
              <p className="text-sm text-gray-500">Loading prompt families...</p>
            ) : families.length === 0 ? (
              <p className="text-sm text-gray-500">No prompt families found for {stage.toLowerCase()}.</p>
            ) : (
              families.map((family) => (
                <button
                  key={family.id}
                  type="button"
                  onClick={() => setSelectedPromptId(family.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left ${
                    family.id === selectedPromptId
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{family.name}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600">
                      {family.isCanonical ? 'Canonical' : 'Custom'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {family.versions.length} version{family.versions.length === 1 ? '' : 's'}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {!selectedPrompt ? (
            <p className="text-sm text-gray-500">
              {loadingPromptDetail ? 'Loading prompt detail...' : 'Select a prompt family to inspect versions.'}
            </p>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-gray-900">{selectedPrompt.name}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                  {selectedPrompt.stage.toLowerCase()}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                  {selectedPrompt.isCanonical ? 'Canonical' : 'Custom'}
                </span>
                {selectedPrompt.defaultSlots.length > 0 ? (
                  selectedPrompt.defaultSlots.map((slot) => (
                    <span key={slot} className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                      {SLOT_LABELS[slot]}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                    No default assigned
                  </span>
                )}
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-gray-900">Versions</h3>
                  {selectedPrompt.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={() => setSelectedVersionId(version.id)}
                      className={`w-full rounded-xl border px-4 py-4 text-left ${
                        version.id === selectedVersionId
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-gray-900">{version.versionLabel}</p>
                        {version.isActive && (
                          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                            active
                          </span>
                        )}
                        {version.defaultSlots.map((slot) => (
                          <span key={slot} className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                            {slot}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">{new Date(version.createdAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  {selectedVersion ? (
                    <>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">{selectedVersion.versionLabel}</h3>
                          {selectedVersion.isActive && (
                            <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                              active version
                            </span>
                          )}
                        </div>
                        <pre className="mt-4 overflow-x-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100 whitespace-pre-wrap">
                          {selectedVersion.templateText || 'Template text unavailable.'}
                        </pre>
                        <div className="mt-4 space-y-3">
                          {defaultSlotsForStage(stage).map((slot) => {
                            const compatibility = selectedVersion.compatibility[slot]
                            const isDefault = selectedVersion.defaultSlots.includes(slot)

                            return (
                              <div key={slot} className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{SLOT_LABELS[slot]}</p>
                                    {compatibility.notes.map((note) => (
                                      <p key={note} className="mt-1 text-xs text-blue-700">{note}</p>
                                    ))}
                                    {!compatibility.valid && compatibility.reasons.map((reason) => (
                                      <p key={reason} className="mt-1 text-xs text-amber-700">{reason}</p>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={
                                      saving ||
                                      isDefault ||
                                      !selectedPrompt.isCanonical ||
                                      !compatibility.valid
                                    }
                                    onClick={() => handleAssignDefault(slot, selectedVersion.id)}
                                    className={`rounded-md px-3 py-2 text-sm font-medium ${
                                      saving || isDefault || !selectedPrompt.isCanonical || !compatibility.valid
                                        ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                    }`}
                                  >
                                    {isDefault ? 'Current default' : 'Make default'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={saving || selectedVersion.isActive}
                            onClick={() => handleActivate(selectedVersion.id)}
                            className={`rounded-md px-4 py-2 text-sm font-medium ${
                              saving || selectedVersion.isActive
                                ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                : 'bg-gray-900 text-white hover:bg-gray-800'
                            }`}
                          >
                            {selectedVersion.isActive ? 'Active version' : 'Activate version'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTemplateText(selectedVersion.templateText || '')}
                            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Copy selected template
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <h3 className="text-lg font-semibold text-gray-900">Create New Version</h3>
                        <div className="mt-4 space-y-4">
                          <label className="block">
                            <span className="block text-sm font-medium text-gray-700">Version label</span>
                            <input
                              value={versionLabel}
                              onChange={(event) => setVersionLabel(event.target.value)}
                              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              placeholder="v2"
                            />
                          </label>

                          <label className="block">
                            <span className="block text-sm font-medium text-gray-700">Template text</span>
                            <textarea
                              value={templateText}
                              onChange={(event) => setTemplateText(event.target.value)}
                              rows={14}
                              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                              placeholder="Write the next prompt version here..."
                            />
                          </label>

                          <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={activateOnCreate}
                              onChange={(event) => setActivateOnCreate(event.target.checked)}
                            />
                            Activate this version after creation
                          </label>

                          <button
                            type="button"
                            disabled={saving}
                            onClick={handleCreateVersion}
                            className={`rounded-md px-4 py-2 text-sm font-medium ${
                              saving
                                ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            Create version
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">Select a version to inspect compatibility and defaults.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
