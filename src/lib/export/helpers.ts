/**
 * Export rendering helpers
 *
 * Pure utility functions for deterministic file rendering.
 * No YAML library — frontmatter is hand-rendered via array-of-tuples.
 *
 * Spec reference: §14.3 (Byte-stable rendering rules)
 */

export const EXPORT_FORMAT_VERSION = 'export_v1'

/**
 * Renders YAML frontmatter from an ordered list of key-value pairs.
 * Flat scalars only (string, number, boolean).
 *
 * Field order matches the input array order — caller controls ordering.
 * String values are double-quoted. Numbers and booleans are unquoted.
 */
export function renderFrontmatter(fields: Array<[string, string | number | boolean]>): string {
  const lines = fields.map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: "${value}"`
    }
    return `${key}: ${value}`
  })
  return `---\n${lines.join('\n')}\n---`
}

/**
 * Recursively sorts object keys alphabetically.
 * Arrays are preserved in order; only object keys are sorted.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/**
 * JSON.stringify with sorted keys, 2-space indent, trailing newline.
 */
export function renderJson(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(obj), null, 2) + '\n'
}
