/**
 * Claude Export Parser
 *
 * Parses the Claude data export format (conversations.json).
 *
 * Supported shape (v0 — Anthropic official data export):
 * [
 *   {
 *     "uuid": "<conversation_id>",
 *     "name": "Conversation Title",
 *     "created_at": "2024-01-15T10:30:00.000000+00:00",
 *     "updated_at": "2024-01-15T11:45:00.000000+00:00",
 *     "chat_messages": [
 *       {
 *         "uuid": "<message_id>",
 *         "text": "Message content",
 *         "sender": "human" | "assistant",
 *         "created_at": "2024-01-15T10:30:00.000000+00:00"
 *       }
 *     ]
 *   }
 * ]
 *
 * Role mapping:
 *   "human"     → "user"
 *   "assistant"  → "assistant"
 *
 * Other sender values are skipped with a warning.
 *
 * Timestamps are ISO 8601 strings (may include timezone offset or microsecond
 * precision). They are parsed to Date objects and normalized downstream via
 * toCanonicalTimestamp (millisecond precision, Z suffix).
 */

import type { Parser, ParseResult, ParsedMessage } from './types'
import type { RoleApi } from '../enums'
import { InvalidInputError } from '../errors'

// Claude export types
interface ClaudeMessage {
  uuid: string
  text: string
  sender: string
  created_at: string
}

interface ClaudeConversation {
  uuid: string
  name: string
  created_at: string
  updated_at: string
  chat_messages: ClaudeMessage[]
}

/**
 * Maps Claude sender to our normalized role.
 * Returns null for unknown senders.
 */
function mapSender(sender: string): RoleApi | null {
  switch (sender) {
    case 'human':
      return 'user'
    case 'assistant':
      return 'assistant'
    default:
      return null
  }
}

/**
 * Parses a Claude conversations.json export.
 */
export const claudeParser: Parser = {
  id: 'claude',
  canParse(content: string): boolean {
    try {
      const data = JSON.parse(content)
      if (!Array.isArray(data)) return false
      if (data.length === 0) return false // Ambiguous empty array — defer to other parsers
      const first = data[0]
      return (
        typeof first === 'object' &&
        first !== null &&
        'uuid' in first &&
        'chat_messages' in first
      )
    } catch {
      return false
    }
  },

  parse(content: string): ParseResult {
    const data = JSON.parse(content)
    const messages: ParsedMessage[] = []
    const warnings: string[] = []

    if (!Array.isArray(data)) {
      throw new InvalidInputError('Claude export must be an array of conversations')
    }

    for (const conversation of data as ClaudeConversation[]) {
      if (!conversation.uuid || !Array.isArray(conversation.chat_messages)) {
        warnings.push('Skipping conversation without uuid or chat_messages')
        continue
      }

      const conversationId = conversation.uuid

      for (const msg of conversation.chat_messages) {
        const role = mapSender(msg.sender)

        if (!role) {
          warnings.push(
            `Skipping message ${msg.uuid} with unknown sender "${msg.sender}" in conversation ${conversationId}`
          )
          continue
        }

        // Skip messages without text content
        if (!msg.text || !msg.text.trim()) {
          continue
        }

        // Skip messages without timestamps
        if (!msg.created_at) {
          warnings.push(
            `Skipping message ${msg.uuid} without timestamp in conversation ${conversationId}`
          )
          continue
        }

        // Parse ISO 8601 timestamp
        const timestampUtc = new Date(msg.created_at)
        if (isNaN(timestampUtc.getTime())) {
          warnings.push(
            `Skipping message ${msg.uuid} with invalid timestamp "${msg.created_at}" in conversation ${conversationId}`
          )
          continue
        }

        messages.push({
          source: 'claude',
          sourceConversationId: conversationId,
          sourceMessageId: msg.uuid,
          timestampUtc,
          role,
          text: msg.text,
        })
      }
    }

    // Sort by timestamp for consistent ordering, then role (user before assistant), then message ID
    messages.sort((a, b) => {
      const tDiff = a.timestampUtc.getTime() - b.timestampUtc.getTime()
      if (tDiff !== 0) return tDiff

      // Role tie-break: user before assistant
      const roleOrder = { user: 0, assistant: 1 } as const
      const rDiff = roleOrder[a.role] - roleOrder[b.role]
      if (rDiff !== 0) return rDiff

      // Final tie-break: message ID
      return (a.sourceMessageId ?? '').localeCompare(b.sourceMessageId ?? '')
    })

    return {
      source: 'claude',
      messages,
      warnings,
    }
  },
}
