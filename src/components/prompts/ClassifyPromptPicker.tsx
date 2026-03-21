'use client'

import React from 'react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ManagedPromptFamily,
  ManagedPromptVersion,
  PromptDefaultSlotApi,
} from '@/lib/types/prompt-management'
import { PromptTextPreview } from './PromptTextPreview'
import {
  canApplyPromptPreview,
  getPreferredPromptFamilyId,
  getPromptVersionForDisplay,
  hasPendingPromptSelection,
} from './classify-prompt-picker-state'

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
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(value?.id ?? null)
  const [loadingFamilyId, setLoadingFamilyId] = useState<string | null>(null)

  useEffect(() => {
    if (forceExpanded) {
      setExpanded(true)
    }
  }, [forceExpanded])

  useEffect(() => {
    setSelectedFamilyId(value?.prompt.id ?? null)
    setPreviewVersionId(value?.id ?? null)
  }, [value?.id, value?.prompt.id])

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
      setSelectedFamilyId(getPreferredPromptFamilyId({ families: items, slot, value }))
    } catch (error) {
      setFamiliesError(error instanceof Error ? error.message : 'Failed to load classify prompts')
    } finally {
      setLoadingFamilies(false)
    }
  }, [slot, value])

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

  const resolvedCurrentValue = useMemo(() => {
    if (!value) return null
    const detail = familyDetails[value.prompt.id]
    return detail?.versions.find((version) => version.id === value.id) ?? value
  }, [familyDetails, value])

  const selectedFamily =
    (selectedFamilyId ? familyDetails[selectedFamilyId] : null) ??
    families.find((family) => family.id === selectedFamilyId) ??
    null
  const waitingOnSelectedFamilyDetail = !!selectedFamilyId && loadingFamilyId === selectedFamilyId && !familyDetails[selectedFamilyId]

  const previewVersion = useMemo(
    () =>
      getPromptVersionForDisplay({
        family: waitingOnSelectedFamilyDetail ? null : selectedFamily,
        previewVersionId,
        value: resolvedCurrentValue,
      }),
    [previewVersionId, resolvedCurrentValue, selectedFamily, waitingOnSelectedFamilyDetail],
  )

  const currentCompatibility = resolvedCurrentValue?.compatibility[slot]
  const previewCompatibility = previewVersion?.compatibility[slot]
  const pendingSelection = hasPendingPromptSelection({
    value: resolvedCurrentValue,
    previewVersion,
  })
  const canApplyPreview = canApplyPromptPreview({
    slot,
    value: resolvedCurrentValue,
    previewVersion,
  })
  const currentPromptStatus =
    resolvedCurrentValue && currentCompatibility
      ? currentCompatibility.valid
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
          {resolvedCurrentValue ? (
            <>
              <p className="mt-1 text-sm font-medium text-gray-900">
                {resolvedCurrentValue.prompt.name} / {resolvedCurrentValue.versionLabel}
              </p>
              <p className={`mt-1 text-sm ${currentCompatibility?.valid ? 'text-green-700' : 'text-amber-700'}`}>
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

      {resolvedCurrentValue && currentCompatibility && !currentCompatibility.valid && currentCompatibility.reasons.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">This prompt cannot run in {mode} mode.</p>
          <ul className="mt-1 space-y-1">
            {currentCompatibility.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <PromptTextPreview
          templateText={resolvedCurrentValue?.templateText}
          description="The currently selected prompt stays visible here even when the selector is collapsed."
          emptyMessage="Prompt text unavailable."
        />
      </div>

      {expanded && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[220px_280px_minmax(0,1fr)]">
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Prompt families</h3>
              <p className="mt-1 text-xs text-gray-500">Choose a family to inspect its versions.</p>
            </div>
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
                    onClick={() => {
                      setSelectedFamilyId(family.id)
                      setPreviewVersionId(null)
                    }}
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
            ) : loadingFamilyId === selectedFamily.id && !familyDetails[selectedFamily.id] ? (
              <p className="text-sm text-gray-500">Loading prompt versions...</p>
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

                <div className="space-y-3">
                  {selectedFamily.versions.map((version) => {
                    const compatibility = version.compatibility[slot]
                    const isCurrent = resolvedCurrentValue?.id === version.id
                    const isPreviewed = previewVersion?.id === version.id

                    return (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => setPreviewVersionId(version.id)}
                        className={`w-full rounded-lg border p-3 text-left ${
                          isPreviewed
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
                          {isPreviewed && !isCurrent && (
                            <span className="rounded-full bg-blue-700 px-2 py-1 text-xs font-medium text-white">
                              previewing
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">{new Date(version.createdAt).toLocaleString()}</p>
                        <p className={`mt-2 text-xs ${compatibility.valid ? 'text-green-700' : 'text-amber-700'}`}>
                          {compatibility.valid
                            ? `Compatible for ${compatibilityLabel(mode)}`
                            : `Incompatible for ${compatibilityLabel(mode)}`}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          <div className="space-y-4">
            {waitingOnSelectedFamilyDetail ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-500">Loading prompt preview...</p>
              </div>
            ) : !previewVersion ? (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <p className="text-sm text-gray-500">Choose a prompt version to preview it before applying.</p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
                      Previewing {previewVersion.prompt.name} / {previewVersion.versionLabel}
                    </h3>
                    {previewVersion.isActive && (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        active
                      </span>
                    )}
                    {previewVersion.defaultSlots.includes(slot) && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                        default for {mode}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-xs text-gray-500">{new Date(previewVersion.createdAt).toLocaleString()}</p>

                  <div className="mt-4">
                    <PromptTextPreview
                      templateText={previewVersion.templateText}
                      description="Inspect the full prompt text here before applying it to the current classify session."
                    />
                  </div>

                  {previewCompatibility?.notes.length ? (
                    <div className="mt-4 space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
                      {previewCompatibility.notes.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  ) : null}

                  {!previewCompatibility?.valid && previewCompatibility?.reasons.length ? (
                    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      {previewCompatibility.reasons.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <button
                      type="button"
                      disabled={!canApplyPreview}
                      onClick={() => previewVersion && onSelect(previewVersion)}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                        !canApplyPreview
                          ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {!pendingSelection ? 'Selected for this session' : 'Use this prompt'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
