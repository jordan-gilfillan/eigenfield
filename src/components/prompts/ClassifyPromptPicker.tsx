'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type {
  ManagedPromptFamily,
  ManagedPromptVersion,
  PromptDefaultSlotApi,
} from '@/lib/types/prompt-management'

type ClassifyMode = 'stub' | 'real'

const SLOT_BY_MODE: Record<ClassifyMode, PromptDefaultSlotApi> = {
  stub: 'CLASSIFY_STUB',
  real: 'CLASSIFY_REAL',
}

function compatibilityLabel(mode: ClassifyMode) {
  return mode === 'real' ? 'real classify' : 'stub classify'
}

function formatApiError(data: unknown, fallback: string) {
  const apiError = data as { error?: { code?: string; message?: string } }
  const code = apiError.error?.code ? `[${apiError.error.code}] ` : ''
  return `${code}${apiError.error?.message || fallback}`
}

interface ClassifyPromptPickerProps {
  mode: ClassifyMode
  value: ManagedPromptVersion | null
  onSelect: (version: ManagedPromptVersion) => void
  forceExpanded?: boolean
}

export function ClassifyPromptPicker({
  mode,
  value,
  onSelect,
  forceExpanded = false,
}: ClassifyPromptPickerProps) {
  const slot = SLOT_BY_MODE[mode]
  const [expanded, setExpanded] = useState(forceExpanded)
  const [families, setFamilies] = useState<ManagedPromptFamily[]>([])
  const [loadingFamilies, setLoadingFamilies] = useState(false)
  const [familiesError, setFamiliesError] = useState<string | null>(null)
  const [familyDetails, setFamilyDetails] = useState<Record<string, ManagedPromptFamily>>({})
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(value?.prompt.id ?? null)
  const [loadingFamilyId, setLoadingFamilyId] = useState<string | null>(null)

  useEffect(() => {
    if (forceExpanded) {
      setExpanded(true)
    }
  }, [forceExpanded])

  useEffect(() => {
    if (value?.prompt.id) {
      setSelectedFamilyId((current) => current ?? value.prompt.id)
    }
  }, [value?.prompt.id])

  const loadFamilies = useCallback(async () => {
    setLoadingFamilies(true)
    setFamiliesError(null)
    try {
      const res = await fetch('/api/distill/prompts?stage=CLASSIFY')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to load classify prompts (${res.status})`))
      }

      const items = ((data as { items?: ManagedPromptFamily[] }).items ?? []) as ManagedPromptFamily[]
      setFamilies(items)

      const preferredFamilyId =
        value?.prompt.id ??
        items.find((family) => family.defaultSlots.includes(slot))?.id ??
        items[0]?.id ??
        null
      setSelectedFamilyId(preferredFamilyId)
    } catch (error) {
      setFamiliesError(error instanceof Error ? error.message : 'Failed to load classify prompts')
    } finally {
      setLoadingFamilies(false)
    }
  }, [slot, value?.prompt.id])

  const loadFamilyDetail = useCallback(async (promptId: string) => {
    setLoadingFamilyId(promptId)
    try {
      const res = await fetch(`/api/distill/prompts/${promptId}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(formatApiError(data, `Failed to load prompt detail (${res.status})`))
      }

      setFamilyDetails((current) => ({
        ...current,
        [promptId]: data as ManagedPromptFamily,
      }))
    } catch (error) {
      setFamiliesError(error instanceof Error ? error.message : 'Failed to load prompt detail')
    } finally {
      setLoadingFamilyId((current) => (current === promptId ? null : current))
    }
  }, [])

  useEffect(() => {
    if (expanded && families.length === 0 && !loadingFamilies) {
      void loadFamilies()
    }
  }, [expanded, families.length, loadFamilies, loadingFamilies])

  useEffect(() => {
    if (!expanded || !selectedFamilyId || familyDetails[selectedFamilyId] || loadingFamilyId === selectedFamilyId) {
      return
    }

    void loadFamilyDetail(selectedFamilyId)
  }, [expanded, familyDetails, loadFamilyDetail, loadingFamilyId, selectedFamilyId])

  const selectedFamily =
    (selectedFamilyId ? familyDetails[selectedFamilyId] : null) ??
    families.find((family) => family.id === selectedFamilyId) ??
    null

  const selectedCompatibility = value?.compatibility[slot]
  const currentPromptStatus =
    value && selectedCompatibility
      ? selectedCompatibility.valid
        ? `Compatible for ${compatibilityLabel(mode)}`
        : `Incompatible for ${compatibilityLabel(mode)}`
      : 'No prompt selected'

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            Classify Prompt
          </p>
          {value ? (
            <>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {value.prompt.name} / {value.versionLabel}
              </p>
              <p className={`mt-1 text-sm ${selectedCompatibility?.valid ? 'text-green-700' : 'text-amber-700'}`}>
                {currentPromptStatus}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-red-700">No prompt available for this mode.</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            {expanded ? 'Hide prompt options' : 'Change prompt'}
          </button>
          <Link href="/distill/prompts" className="text-sm font-medium text-blue-700 hover:text-blue-800">
            Manage prompts
          </Link>
        </div>
      </div>

      {value && selectedCompatibility && !selectedCompatibility.valid && selectedCompatibility.reasons.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">This prompt cannot run in {mode} mode.</p>
          <ul className="mt-1 space-y-1">
            {selectedCompatibility.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-2">
            {loadingFamilies ? (
              <p className="text-sm text-gray-500">Loading classify prompts...</p>
            ) : families.length === 0 ? (
              <p className="text-sm text-gray-500">No classify prompt families found.</p>
            ) : (
              families.map((family) => {
                const isSelected = family.id === selectedFamilyId
                return (
                  <button
                    key={family.id}
                    type="button"
                    onClick={() => setSelectedFamilyId(family.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium">{family.name}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {family.isCanonical ? 'Canonical' : 'Custom'} prompt family
                    </div>
                  </button>
                )
              })
            )}
            {familiesError && <p className="text-sm text-red-700">{familiesError}</p>}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {!selectedFamily ? (
              <p className="text-sm text-gray-500">Choose a prompt family to inspect versions.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-gray-900">{selectedFamily.name}</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                    {selectedFamily.isCanonical ? 'Canonical' : 'Custom'}
                  </span>
                  {selectedFamily.defaultSlots.length > 0 ? (
                    selectedFamily.defaultSlots.map((defaultSlot) => (
                      <span
                        key={defaultSlot}
                        className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700"
                      >
                        {defaultSlot}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">
                      No default slots
                    </span>
                  )}
                </div>

                {loadingFamilyId === selectedFamily.id && !familyDetails[selectedFamily.id] ? (
                  <p className="text-sm text-gray-500">Loading prompt versions...</p>
                ) : (
                  <div className="space-y-3">
                    {selectedFamily.versions.map((version) => {
                      const compatibility = version.compatibility[slot]
                      const isCurrent = value?.id === version.id

                      return (
                        <div key={version.id} className="rounded-lg border border-gray-200 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900">{version.versionLabel}</p>
                            {version.isActive && (
                              <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                                active
                              </span>
                            )}
                            {version.defaultSlots.includes(slot) && (
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                                default for {mode}
                              </span>
                            )}
                            {isCurrent && (
                              <span className="rounded-full bg-gray-900 px-2 py-1 text-xs font-medium text-white">
                                current
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-gray-500">{new Date(version.createdAt).toLocaleString()}</p>
                          {version.templateText && (
                            <pre className="mt-3 overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-100 whitespace-pre-wrap">
                              {version.templateText}
                            </pre>
                          )}
                          {compatibility.notes.length > 0 && (
                            <div className="mt-3 space-y-1 text-xs text-blue-700">
                              {compatibility.notes.map((note) => (
                                <p key={note}>{note}</p>
                              ))}
                            </div>
                          )}
                          {!compatibility.valid && compatibility.reasons.length > 0 && (
                            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                              {compatibility.reasons.map((reason) => (
                                <p key={reason}>{reason}</p>
                              ))}
                            </div>
                          )}
                          <div className="mt-3">
                            <button
                              type="button"
                              disabled={!compatibility.valid || isCurrent}
                              onClick={() => onSelect(version)}
                              className={`rounded-md px-3 py-2 text-sm font-medium ${
                                !compatibility.valid || isCurrent
                                  ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                                  : 'bg-blue-600 text-white hover:bg-blue-700'
                              }`}
                            >
                              {isCurrent ? 'Selected' : 'Use this prompt'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
