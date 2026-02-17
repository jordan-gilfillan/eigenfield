/**
 * Route validation helpers.
 *
 * Return-based validators for use in Next.js route handlers.
 * Each returns an error message string on failure, or undefined on success.
 * Chain with ?? for first-error-wins semantics:
 *
 *   const fail = requireField(body.x, 'x') ?? requireField(body.y, 'y')
 *   if (fail) return errors.invalidInput(fail)
 */

/**
 * Fail if `!value` (matches typical `if (!body.field)` guard).
 * Default message: "${fieldName} is required"
 */
export function requireField(
  value: unknown,
  fieldName: string,
  message?: string,
): string | undefined {
  if (!value) {
    return message ?? `${fieldName} is required`
  }
  return undefined
}

/**
 * Fail if both values are truthy or neither is truthy.
 * Messages are explicit — not templated — because XOR wording varies.
 */
export function requireXor(
  a: unknown,
  b: unknown,
  messageIfBoth: string,
  messageIfNeither: string,
): string | undefined {
  if (a && b) return messageIfBoth
  if (!a && !b) return messageIfNeither
  return undefined
}

/**
 * Fail if value is not a non-empty array (also fails on nullish).
 * Use for required array fields like `sources`.
 */
export function requireNonEmptyArray(
  value: unknown,
  message: string,
): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return message
  }
  return undefined
}

/**
 * If value is falsy, pass (nothing to validate).
 * If value is truthy but not a non-empty array, fail.
 * Use for optional/conditional array fields where presence is guarded
 * elsewhere (e.g. importBatchIds guarded by XOR).
 */
export function validateNonEmptyArray(
  value: unknown,
  message: string,
): string | undefined {
  if (!value) return undefined
  if (!Array.isArray(value) || value.length === 0) {
    return message
  }
  return undefined
}

/**
 * If value is not an array, pass (caller should validate shape first).
 * If array has duplicates, fail.
 */
export function requireUniqueArray(
  value: unknown,
  message: string,
): string | undefined {
  if (!Array.isArray(value)) return undefined
  if (new Set(value).size !== value.length) {
    return message
  }
  return undefined
}

/**
 * Fail if value does not match YYYY-MM-DD format.
 * Default message: "${fieldName} must be in YYYY-MM-DD format"
 */
export function requireDateFormat(
  value: string,
  fieldName: string,
  message?: string,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return message ?? `${fieldName} must be in YYYY-MM-DD format`
  }

  const [yearPart, monthPart, dayPart] = value.split('-')
  const year = Number.parseInt(yearPart, 10)
  const month = Number.parseInt(monthPart, 10)
  const day = Number.parseInt(dayPart, 10)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return message ?? `${fieldName} must be in YYYY-MM-DD format`
  }

  // Semantic check: reject impossible dates (e.g. 2024-02-30).
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return message ?? `${fieldName} must be in YYYY-MM-DD format`
  }

  return undefined
}

/**
 * Fail if value is not a valid IANA timezone.
 * Default message: "${fieldName} must be a valid IANA timezone"
 */
export function requireValidTimezone(
  value: string,
  fieldName: string,
  message?: string,
): string | undefined {
  if (value.trim().length === 0) {
    return message ?? `${fieldName} must be a valid IANA timezone`
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
  } catch (error) {
    if (error instanceof RangeError) {
      return message ?? `${fieldName} must be a valid IANA timezone`
    }
    throw error
  }

  return undefined
}
