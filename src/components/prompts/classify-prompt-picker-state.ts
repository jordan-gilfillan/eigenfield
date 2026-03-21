import type {
  ManagedPromptFamily,
  ManagedPromptVersion,
  PromptDefaultSlotApi,
} from '@/lib/types/prompt-management'

export function getPreferredPromptFamilyId(options: {
  families: ManagedPromptFamily[]
  slot: PromptDefaultSlotApi
  value: ManagedPromptVersion | null
}) {
  const { families, slot, value } = options
  return (
    value?.prompt.id ??
    families.find((family) => family.defaultSlots.includes(slot))?.id ??
    families[0]?.id ??
    null
  )
}

export function getPromptVersionForDisplay(options: {
  family: ManagedPromptFamily | null
  previewVersionId: string | null
  value: ManagedPromptVersion | null
}) {
  const { family, previewVersionId, value } = options
  if (!family) {
    return value
  }

  if (previewVersionId) {
    return family.versions.find((version) => version.id === previewVersionId) ?? null
  }

  if (value?.prompt.id === family.id) {
    return family.versions.find((version) => version.id === value.id) ?? value
  }

  return family.versions[0] ?? null
}

export function hasPendingPromptSelection(options: {
  value: ManagedPromptVersion | null
  previewVersion: ManagedPromptVersion | null
}) {
  const { value, previewVersion } = options
  return !!previewVersion && previewVersion.id !== value?.id
}

export function canApplyPromptPreview(options: {
  slot: PromptDefaultSlotApi
  value: ManagedPromptVersion | null
  previewVersion: ManagedPromptVersion | null
}) {
  const { slot, value, previewVersion } = options
  if (!previewVersion) {
    return false
  }

  return previewVersion.compatibility[slot].valid && previewVersion.id !== value?.id
}
