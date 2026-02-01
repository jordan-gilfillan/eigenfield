/**
 * Text normalization utilities
 *
 * Spec reference: Section 5.1
 *
 * Rules:
 * - preserve original characters
 * - normalize line endings to \n
 * - trim trailing whitespace on each line
 * - preserve leading whitespace (don't destroy code blocks)
 */

/**
 * Normalizes text according to spec 5.1 rules.
 *
 * @param text - The raw text to normalize
 * @returns Normalized text suitable for hashing
 */
export function normalizeText(text: string): string {
  // Step 1: Normalize line endings (CRLF -> LF, CR -> LF)
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Step 2: Trim trailing whitespace on each line, preserving leading whitespace
  normalized = normalized
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')

  return normalized
}
