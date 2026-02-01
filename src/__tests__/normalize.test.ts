import { describe, it, expect } from 'vitest'
import { normalizeText } from '../lib/normalize'

describe('normalizeText', () => {
  it('converts CRLF to LF', () => {
    const input = 'line1\r\nline2\r\nline3'
    const expected = 'line1\nline2\nline3'
    expect(normalizeText(input)).toBe(expected)
  })

  it('converts standalone CR to LF', () => {
    const input = 'line1\rline2\rline3'
    const expected = 'line1\nline2\nline3'
    expect(normalizeText(input)).toBe(expected)
  })

  it('preserves existing LF', () => {
    const input = 'line1\nline2\nline3'
    expect(normalizeText(input)).toBe(input)
  })

  it('trims trailing whitespace on each line', () => {
    const input = 'line1   \nline2\t\nline3  \t  '
    const expected = 'line1\nline2\nline3'
    expect(normalizeText(input)).toBe(expected)
  })

  it('preserves leading whitespace (code blocks)', () => {
    const input = '  indented\n    more indented\n\ttabbed'
    expect(normalizeText(input)).toBe(input)
  })

  it('handles mixed line endings', () => {
    const input = 'line1\r\nline2\rline3\nline4'
    const expected = 'line1\nline2\nline3\nline4'
    expect(normalizeText(input)).toBe(expected)
  })

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('')
  })

  it('handles single line with trailing whitespace', () => {
    const input = 'hello world   '
    const expected = 'hello world'
    expect(normalizeText(input)).toBe(expected)
  })

  it('preserves empty lines', () => {
    const input = 'line1\n\nline3'
    expect(normalizeText(input)).toBe(input)
  })

  it('handles code block with mixed indentation', () => {
    const input = 'function foo() {\n  const x = 1;  \n  return x;\n}'
    const expected = 'function foo() {\n  const x = 1;\n  return x;\n}'
    expect(normalizeText(input)).toBe(expected)
  })
})
