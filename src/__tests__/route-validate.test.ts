/**
 * Unit tests for route-validate helpers.
 * Pure functions — no DB, no NextResponse.
 */

import { describe, it, expect } from 'vitest'
import {
  requireField,
  requireXor,
  requireNonEmptyArray,
  validateNonEmptyArray,
  requireUniqueArray,
  requireDateFormat,
} from '@/lib/route-validate'

describe('requireField', () => {
  it('returns undefined for truthy string', () => {
    expect(requireField('hello', 'name')).toBeUndefined()
  })

  it('returns message for undefined', () => {
    expect(requireField(undefined, 'startDate')).toBe('startDate is required')
  })

  it('returns message for null', () => {
    expect(requireField(null, 'model')).toBe('model is required')
  })

  it('returns message for empty string', () => {
    expect(requireField('', 'mode')).toBe('mode is required')
  })

  it('returns message for 0 (falsy)', () => {
    expect(requireField(0, 'field')).toBe('field is required')
  })

  it('uses custom message when provided', () => {
    expect(requireField(undefined, 'x', 'custom msg')).toBe('custom msg')
  })
})

describe('requireXor', () => {
  it('passes when only a is truthy', () => {
    expect(requireXor('a', undefined, 'both', 'neither')).toBeUndefined()
  })

  it('passes when only b is truthy', () => {
    expect(requireXor(undefined, ['x'], 'both', 'neither')).toBeUndefined()
  })

  it('fails with messageIfBoth when both truthy', () => {
    expect(requireXor('a', ['x'], 'not both', 'required')).toBe('not both')
  })

  it('fails with messageIfNeither when both falsy', () => {
    expect(requireXor(undefined, undefined, 'not both', 'required')).toBe('required')
  })

  it('treats empty array as truthy', () => {
    expect(requireXor('a', [], 'not both', 'required')).toBe('not both')
  })
})

describe('requireNonEmptyArray', () => {
  it('passes for non-empty array', () => {
    expect(requireNonEmptyArray(['a'], 'msg')).toBeUndefined()
  })

  it('fails for empty array', () => {
    expect(requireNonEmptyArray([], 'must be non-empty')).toBe('must be non-empty')
  })

  it('fails for undefined', () => {
    expect(requireNonEmptyArray(undefined, 'required')).toBe('required')
  })

  it('fails for null', () => {
    expect(requireNonEmptyArray(null, 'required')).toBe('required')
  })

  it('fails for non-array truthy value', () => {
    expect(requireNonEmptyArray('string', 'msg')).toBe('msg')
  })
})

describe('validateNonEmptyArray', () => {
  it('passes for non-empty array', () => {
    expect(validateNonEmptyArray(['a'], 'msg')).toBeUndefined()
  })

  it('passes for undefined (nothing to validate)', () => {
    expect(validateNonEmptyArray(undefined, 'msg')).toBeUndefined()
  })

  it('passes for null (nothing to validate)', () => {
    expect(validateNonEmptyArray(null, 'msg')).toBeUndefined()
  })

  it('passes for 0 (falsy, nothing to validate)', () => {
    expect(validateNonEmptyArray(0, 'msg')).toBeUndefined()
  })

  it('fails for empty array (truthy but empty)', () => {
    expect(validateNonEmptyArray([], 'non-empty')).toBe('non-empty')
  })

  it('fails for truthy non-array', () => {
    expect(validateNonEmptyArray('string', 'msg')).toBe('msg')
  })
})

describe('requireUniqueArray', () => {
  it('passes for unique array', () => {
    expect(requireUniqueArray(['a', 'b', 'c'], 'msg')).toBeUndefined()
  })

  it('fails for array with duplicates', () => {
    expect(requireUniqueArray(['a', 'a'], 'unique')).toBe('unique')
  })

  it('passes for non-array (nothing to validate)', () => {
    expect(requireUniqueArray('string', 'msg')).toBeUndefined()
  })

  it('passes for undefined', () => {
    expect(requireUniqueArray(undefined, 'msg')).toBeUndefined()
  })
})

describe('requireDateFormat', () => {
  it('passes for valid YYYY-MM-DD', () => {
    expect(requireDateFormat('2024-01-15', 'startDate')).toBeUndefined()
  })

  it('fails for DD-MM-YYYY', () => {
    expect(requireDateFormat('15-01-2024', 'startDate')).toBe(
      'startDate must be in YYYY-MM-DD format',
    )
  })

  it('fails for slash format', () => {
    expect(requireDateFormat('2024/01/15', 'endDate')).toBe(
      'endDate must be in YYYY-MM-DD format',
    )
  })

  it('fails for non-date string', () => {
    expect(requireDateFormat('not-a-date', 'startDate')).toBeDefined()
  })

  it('uses custom message when provided', () => {
    expect(requireDateFormat('bad', 'f', 'custom')).toBe('custom')
  })
})
