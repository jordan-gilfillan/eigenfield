/**
 * Parser exports and auto-detection
 */

import type { Parser, ParseResult } from './types'
import type { SourceApi } from '../enums'
import { chatgptParser } from './chatgpt'
import { claudeParser } from './claude'

export type { Parser, ParseResult, ParsedMessage } from './types'

/**
 * Registry of available parsers.
 */
const parsers: Record<SourceApi, Parser | null> = {
  chatgpt: chatgptParser,
  claude: claudeParser,
  grok: null, // Phase 7
  mixed: null, // Not a real parser
}

/**
 * Gets a parser for the specified source.
 * @throws Error if parser not implemented
 */
export function getParser(source: SourceApi): Parser {
  const parser = parsers[source]
  if (!parser) {
    throw new Error(`Parser for source "${source}" is not implemented`)
  }
  return parser
}

/**
 * Auto-detects the source format and parses the content.
 * @param content - Raw file content
 * @returns ParseResult with detected source
 * @throws Error if no parser can handle the content
 */
export function autoDetectAndParse(content: string): ParseResult {
  // Try each parser in order
  const parserOrder: SourceApi[] = ['chatgpt', 'claude', 'grok']

  for (const source of parserOrder) {
    const parser = parsers[source]
    if (parser && parser.canParse(content)) {
      return parser.parse(content)
    }
  }

  throw new Error(
    'Could not auto-detect export format. Please specify the source explicitly.'
  )
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
