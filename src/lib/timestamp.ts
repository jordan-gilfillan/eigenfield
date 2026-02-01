/**
 * Timestamp utilities
 *
 * Spec reference: Section 5.2
 *
 * Timestamp canonicalization (required):
 * - timestampUtcISO MUST be RFC 3339 / ISO 8601 in UTC
 * - MUST have exactly millisecond precision and a Z suffix
 * - format: YYYY-MM-DDTHH:mm:ss.SSSZ
 * - example: 2024-01-15T10:30:00.000Z
 * - If a source has no millisecond precision, set milliseconds to .000
 * - If a source provides an offset, convert to UTC and render with Z
 */

/**
 * Converts a Date to canonical RFC3339 timestamp with millisecond precision.
 *
 * @param date - The date to convert
 * @returns ISO 8601 string in format YYYY-MM-DDTHH:mm:ss.SSSZ
 */
export function toCanonicalTimestamp(date: Date): string {
  return date.toISOString()
}

/**
 * Parses various timestamp formats and returns a canonical timestamp string.
 * Handles:
 * - ISO 8601 with or without milliseconds
 * - Timestamps with timezone offsets
 * - Unix timestamps (seconds or milliseconds)
 *
 * @param input - Timestamp in various formats
 * @returns Canonical RFC3339 timestamp string
 * @throws Error if timestamp cannot be parsed
 */
export function parseToCanonicalTimestamp(input: string | number): string {
  let date: Date

  if (typeof input === 'number') {
    // Assume milliseconds if > 10 digits, otherwise seconds
    const ms = input > 9999999999 ? input : input * 1000
    date = new Date(ms)
  } else {
    // Parse string timestamp
    date = new Date(input)
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${input}`)
  }

  return toCanonicalTimestamp(date)
}

/**
 * Extracts the date portion (YYYY-MM-DD) from a timestamp in a specific timezone.
 *
 * @param timestamp - UTC timestamp (Date or string)
 * @param timezone - IANA timezone string (e.g., "America/Los_Angeles")
 * @returns Date string in YYYY-MM-DD format for the given timezone
 */
export function extractDayDate(
  timestamp: Date | string,
  timezone: string
): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp

  // Use Intl.DateTimeFormat to get the date in the target timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(date)
}
