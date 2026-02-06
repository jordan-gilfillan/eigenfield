/**
 * Parser exports and auto-detection
 *
 * PR-7.3: Auto-detection runs ALL parsers' canParse() and requires exactly
 * one match. If 0 match → UNSUPPORTED_FORMAT. If >1 match → AMBIGUOUS_FORMAT.
 */

import type { Parser, ParseResult } from './types'
import type { SourceApi } from '../enums'
import { chatgptParser } from './chatgpt'
import { claudeParser } from './claude'
import { grokParser } from './grok'

export type { Parser, ParseResult, ParsedMessage } from './types'

/**
 * Ordered list of parsers available for auto-detection.
 * "mixed" is not a real parser — excluded from detection.
 */
const parserList: Parser[] = [chatgptParser, claudeParser, grokParser]

/**
 * Registry of available parsers keyed by source.
 */
const parserMap: Partial<Record<SourceApi, Parser>> = {
  chatgpt: chatgptParser,
  claude: claudeParser,
  grok: grokParser,
}

/**
 * Gets a parser for the specified source.
 * @throws Error if parser not implemented
 */
export function getParser(source: SourceApi): Parser {
  const parser = parserMap[source]
  if (!parser) {
    throw new Error(`Parser for source "${source}" is not implemented`)
  }
  return parser
}

/**
 * Error thrown when auto-detection matches zero parsers.
 */
export class UnsupportedFormatError extends Error {
  readonly code = 'UNSUPPORTED_FORMAT' as const
  constructor() {
    super('Could not auto-detect export format. No parser matched the input.')
    this.name = 'UnsupportedFormatError'
  }
}

/**
 * Error thrown when auto-detection matches more than one parser.
 */
export class AmbiguousFormatError extends Error {
  readonly code = 'AMBIGUOUS_FORMAT' as const
  readonly matched: SourceApi[]
  constructor(matched: SourceApi[]) {
    super(
      `Ambiguous export format: multiple parsers matched (${matched.join(', ')}). Please specify sourceOverride.`
    )
    this.name = 'AmbiguousFormatError'
    this.matched = matched
  }
}

/**
 * Auto-detects the source format and parses the content.
 *
 * Runs canParse() on ALL registered parsers:
 * - Exactly 1 match → parse with that parser
 * - 0 matches → throw UnsupportedFormatError
 * - >1 matches → throw AmbiguousFormatError with matched parser ids
 *
 * @param content - Raw file content
 * @returns ParseResult with detected source
 * @throws UnsupportedFormatError if no parser matches
 * @throws AmbiguousFormatError if multiple parsers match
 */
export function autoDetectAndParse(content: string): ParseResult {
  const matched = parserList.filter((p) => p.canParse(content))

  if (matched.length === 0) {
    throw new UnsupportedFormatError()
  }

  if (matched.length > 1) {
    throw new AmbiguousFormatError(matched.map((p) => p.id))
  }

  return matched[0].parse(content)
}

/**
 * Parses content with an explicit source, or auto-detects if not specified.
 * @param content - Raw file content
 * @param source - Optional source override
 * @returns ParseResult
 */
export function parseExport(content: string, source?: SourceApi): ParseResult {
  if (source && source !== 'mixed') {
    return getParser(source).parse(content)
  }
  return autoDetectAndParse(content)
}
