import { describe, it, expect } from 'vitest'
import {
  toCanonicalTimestamp,
  parseToCanonicalTimestamp,
  extractDayDate,
} from '../lib/timestamp'

describe('toCanonicalTimestamp', () => {
  it('formats date with millisecond precision and Z suffix', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(toCanonicalTimestamp(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  it('pads milliseconds to 3 digits', () => {
    const date = new Date('2024-01-15T10:30:00.005Z')
    expect(toCanonicalTimestamp(date)).toBe('2024-01-15T10:30:00.005Z')
  })

  it('handles dates with no milliseconds', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    expect(toCanonicalTimestamp(date)).toBe('2024-01-15T10:30:00.000Z')
  })
})

describe('parseToCanonicalTimestamp', () => {
  it('parses ISO 8601 with milliseconds', () => {
    const result = parseToCanonicalTimestamp('2024-01-15T10:30:00.123Z')
    expect(result).toBe('2024-01-15T10:30:00.123Z')
  })

  it('parses ISO 8601 without milliseconds', () => {
    const result = parseToCanonicalTimestamp('2024-01-15T10:30:00Z')
    expect(result).toBe('2024-01-15T10:30:00.000Z')
  })

  it('converts timezone offset to UTC', () => {
    // 10:30 PST = 18:30 UTC
    const result = parseToCanonicalTimestamp('2024-01-15T10:30:00-08:00')
    expect(result).toBe('2024-01-15T18:30:00.000Z')
  })

  it('parses Unix timestamp in seconds', () => {
    // 1705316400 = 2024-01-15T11:00:00Z
    const result = parseToCanonicalTimestamp(1705316400)
    expect(result).toBe('2024-01-15T11:00:00.000Z')
  })

  it('parses Unix timestamp in milliseconds', () => {
    // 1705316400123 = 2024-01-15T11:00:00.123Z
    const result = parseToCanonicalTimestamp(1705316400123)
    expect(result).toBe('2024-01-15T11:00:00.123Z')
  })

  it('throws on invalid timestamp', () => {
    expect(() => parseToCanonicalTimestamp('not-a-date')).toThrow(
      'Invalid timestamp'
    )
  })
})

describe('extractDayDate', () => {
  it('extracts date in UTC timezone', () => {
    const timestamp = new Date('2024-01-15T23:30:00.000Z')
    expect(extractDayDate(timestamp, 'UTC')).toBe('2024-01-15')
  })

  it('handles timezone offset crossing day boundary', () => {
    // 2024-01-15 23:30 UTC = 2024-01-15 15:30 PST (same day)
    const timestamp = new Date('2024-01-15T23:30:00.000Z')
    expect(extractDayDate(timestamp, 'America/Los_Angeles')).toBe('2024-01-15')
  })

  it('handles timezone offset to next day', () => {
    // 2024-01-15 08:00 UTC = 2024-01-15 17:00 Tokyo (same day)
    const timestamp = new Date('2024-01-15T08:00:00.000Z')
    expect(extractDayDate(timestamp, 'Asia/Tokyo')).toBe('2024-01-15')
  })

  it('handles timezone offset to previous day', () => {
    // 2024-01-15 02:00 UTC = 2024-01-14 18:00 PST (previous day)
    const timestamp = new Date('2024-01-15T02:00:00.000Z')
    expect(extractDayDate(timestamp, 'America/Los_Angeles')).toBe('2024-01-14')
  })

  it('accepts string timestamp', () => {
    expect(extractDayDate('2024-01-15T10:30:00.000Z', 'UTC')).toBe('2024-01-15')
  })
})
