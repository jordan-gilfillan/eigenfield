export const BAD_OUTPUT_REASON_KEYS = [
  'invalid_json',
  'non_object',
  'bad_category_field',
  'invalid_category_value',
  'bad_confidence_field',
  'confidence_out_of_range',
] as const

export type BadOutputReasonKey = (typeof BAD_OUTPUT_REASON_KEYS)[number]

export interface ClassifyWarningDetails {
  badOutputReasons: Record<BadOutputReasonKey, number>
  badCategorySamples: string[]
  aliasedCategorySamples: string[]
}

const SAMPLE_CAP = 5
const SAMPLE_MAX_CHARS = 80

function createBadOutputReasons(): Record<BadOutputReasonKey, number> {
  return {
    invalid_json: 0,
    non_object: 0,
    bad_category_field: 0,
    invalid_category_value: 0,
    bad_confidence_field: 0,
    confidence_out_of_range: 0,
  }
}

function sanitizeSample(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length <= SAMPLE_MAX_CHARS) return trimmed
  return `${trimmed.slice(0, SAMPLE_MAX_CHARS)}...`
}

function addUniqueSample(samples: string[], value: string) {
  const sample = sanitizeSample(value)
  if (!sample || samples.includes(sample) || samples.length >= SAMPLE_CAP) return
  samples.push(sample)
}

export function createEmptyClassifyWarningDetails(): ClassifyWarningDetails {
  return {
    badOutputReasons: createBadOutputReasons(),
    badCategorySamples: [],
    aliasedCategorySamples: [],
  }
}

export function recordBadOutputReason(
  details: ClassifyWarningDetails,
  reason: BadOutputReasonKey,
  invalidCategorySample?: string,
) {
  details.badOutputReasons[reason] += 1
  if (reason === 'invalid_category_value' && invalidCategorySample) {
    addUniqueSample(details.badCategorySamples, invalidCategorySample)
  }
}

export function recordAliasedCategory(details: ClassifyWarningDetails, sample: string) {
  addUniqueSample(details.aliasedCategorySamples, sample)
}

export function hasClassifyWarningDetails(details: ClassifyWarningDetails): boolean {
  return BAD_OUTPUT_REASON_KEYS.some((key) => details.badOutputReasons[key] > 0) ||
    details.badCategorySamples.length > 0 ||
    details.aliasedCategorySamples.length > 0
}

export function cloneClassifyWarningDetails(details: ClassifyWarningDetails): ClassifyWarningDetails {
  return {
    badOutputReasons: {
      invalid_json: details.badOutputReasons.invalid_json,
      non_object: details.badOutputReasons.non_object,
      bad_category_field: details.badOutputReasons.bad_category_field,
      invalid_category_value: details.badOutputReasons.invalid_category_value,
      bad_confidence_field: details.badOutputReasons.bad_confidence_field,
      confidence_out_of_range: details.badOutputReasons.confidence_out_of_range,
    },
    badCategorySamples: [...details.badCategorySamples],
    aliasedCategorySamples: [...details.aliasedCategorySamples],
  }
}

export function parseClassifyWarningDetailsJson(value: unknown): ClassifyWarningDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const raw = value as {
    badOutputReasons?: unknown
    badCategorySamples?: unknown
    aliasedCategorySamples?: unknown
  }

  const details = createEmptyClassifyWarningDetails()

  if (raw.badOutputReasons && typeof raw.badOutputReasons === 'object' && !Array.isArray(raw.badOutputReasons)) {
    for (const key of BAD_OUTPUT_REASON_KEYS) {
      const count = (raw.badOutputReasons as Record<string, unknown>)[key]
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        details.badOutputReasons[key] = Math.floor(count)
      }
    }
  }

  if (Array.isArray(raw.badCategorySamples)) {
    for (const sample of raw.badCategorySamples) {
      if (typeof sample === 'string') addUniqueSample(details.badCategorySamples, sample)
    }
  }

  if (Array.isArray(raw.aliasedCategorySamples)) {
    for (const sample of raw.aliasedCategorySamples) {
      if (typeof sample === 'string') addUniqueSample(details.aliasedCategorySamples, sample)
    }
  }

  return hasClassifyWarningDetails(details) ? details : null
}

export function formatClassifyWarningDetailsForLog(details: ClassifyWarningDetails | null): string {
  if (!details) return ''

  const reasonSummary = BAD_OUTPUT_REASON_KEYS
    .map((key) => ({ key, count: details.badOutputReasons[key] }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((item) => `${item.key}=${item.count}`)
    .join(' ')

  const parts: string[] = []
  if (reasonSummary) {
    parts.push(`reasons=${reasonSummary}`)
  }
  if (details.badCategorySamples.length > 0) {
    parts.push(`invalidCategories=${details.badCategorySamples.join(',')}`)
  }
  if (details.aliasedCategorySamples.length > 0) {
    parts.push(`aliasedSamples=${details.aliasedCategorySamples.join(',')}`)
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}
