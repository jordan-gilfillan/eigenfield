/**
 * Parser types
 *
 * Common types used by all export parsers (ChatGPT, Claude, Grok).
 */

import type { SourceApi, RoleApi } from '../enums'

/**
 * A parsed message from any export format.
 * This is the normalized intermediate representation before creating MessageAtoms.
 */
export interface ParsedMessage {
  /** Source platform */
  source: SourceApi
  /** Conversation ID from the source (if available) */
  sourceConversationId: string | null
  /** Message ID from the source (if available) */
  sourceMessageId: string | null
  /** UTC timestamp */
  timestampUtc: Date
  /** Message role */
  role: RoleApi
  /** Message text content */
  text: string
}

/**
 * Result from parsing an export file.
 */
export interface ParseResult {
  /** Detected or specified source */
  source: SourceApi
  /** Parsed messages */
  messages: ParsedMessage[]
  /** Any warnings encountered during parsing */
  warnings: string[]
}

/**
 * Parser interface that all format-specific parsers must implement.
 */
export interface Parser {
  /**
   * Attempts to parse the given content.
   * @param content - Raw file content (usually JSON string)
   * @returns ParseResult if successful
   * @throws Error if content is not valid for this parser
   */
  parse(content: string): ParseResult

  /**
   * Checks if this parser can handle the given content.
   * Used for auto-detection.
   * @param content - Raw file content
   * @returns true if this parser can likely handle the content
   */
  canParse(content: string): boolean
}
