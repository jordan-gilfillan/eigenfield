/**
 * Grok Export Parser
 *
 * Parses the Grok data export format (conversations JSON).
 *
 * Supported shape (v0 — xAI Grok data export):
 * {
 *   "conversations": [
 *     {
 *       "conversation": {
 *         "id": "<conversation_id>",
 *         "title": "Conversation Title",
 *         "create_time": "2024-01-15T10:30:00.000000Z",
 *         ...
 *       },
 *       "responses": [
 *         {
 *           "response": {
 *             "_id": "<message_id>",
 *             "conversation_id": "<conversation_id>",
 *             "message": "Message content",
 *             "sender": "human" | "assistant",
 *             "create_time": { "$date": { "$numberLong": "1705312200000" } },
 *             "model": "grok-3",
 *             ...
 *           },
 *           "share_link"?: ...
 *         }
 *       ]
 *     }
 *   ],
 *   "projects": [],
 *   "tasks": []
 * }
 *
 * Role mapping:
 *   "human"     → "user"
 *   "assistant"  → "assistant"  (case-insensitive: "ASSISTANT" also maps to "assistant")
 *
 * Other sender values are skipped with a warning.
 *
 * Timestamps use MongoDB extended JSON format:
 *   { "$date": { "$numberLong": "<milliseconds_since_epoch>" } }
 * The $numberLong value is a string containing milliseconds since Unix epoch.
 */

import type { Parser, ParseResult, ParsedMessage } from './types'
import type { RoleApi } from '../enums'
import { InvalidInputError } from '../errors'

// Grok export types
interface GrokTimestamp {
  $date: {
    $numberLong: string
  }
}

interface GrokResponse {
  _id: string
  conversation_id: string
  message: string
  sender: string
  create_time: GrokTimestamp
  model?: string
}

interface GrokResponseWrapper {
  response: GrokResponse
}

interface GrokConversation {
  id: string
  title?: string
  create_time?: string
}

interface GrokConversationWrapper {
  conversation: GrokConversation
  responses: GrokResponseWrapper[]
}

interface GrokExport {
  conversations: GrokConversationWrapper[]
}

/**
 * Maps Grok sender to our normalized role (case-insensitive).
 * Returns null for unknown senders.
 */
function mapSender(sender: string): RoleApi | null {
  switch (sender.toLowerCase()) {
    case 'human':
      return 'user'
    case 'assistant':
      return 'assistant'
    default:
      return null
  }
}

/**
 * Parses a Grok MongoDB extended JSON timestamp to a Date.
 * Expected format: { $date: { $numberLong: "milliseconds" } }
 * Returns null if the format is invalid.
 */
function parseGrokTimestamp(ct: unknown): Date | null {
  if (
    typeof ct !== 'object' ||
    ct === null ||
    !('$date' in ct)
  ) {
    return null
  }

  const dateObj = (ct as Record<string, unknown>)['$date']
  if (
    typeof dateObj !== 'object' ||
    dateObj === null ||
    !('$numberLong' in dateObj)
  ) {
    return null
  }

  const msStr = (dateObj as Record<string, unknown>)['$numberLong']
  if (typeof msStr !== 'string') {
    return null
  }

  const ms = Number(msStr)
  if (!Number.isFinite(ms)) {
    return null
  }

  const date = new Date(ms)
  if (isNaN(date.getTime())) {
    return null
  }

  return date
}

/**
 * Checks if a value looks like a Grok export object.
 * Must be an object with a "conversations" array where each element has
 * "conversation" and "responses" keys, and responses contain objects with
 * the "_id", "sender", and "create_time" fields in the Grok format.
 */
function isGrokShape(data: unknown): data is GrokExport {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  if (!('conversations' in data)) return false
  const conversations = (data as Record<string, unknown>)['conversations']
  if (!Array.isArray(conversations)) return false
  if (conversations.length === 0) return false

  // Check the first conversation has the expected shape
  const first = conversations[0]
  if (typeof first !== 'object' || first === null) return false
  if (!('conversation' in first) || !('responses' in first)) return false

  const conv = (first as Record<string, unknown>)['conversation']
  if (typeof conv !== 'object' || conv === null) return false
  if (!('id' in conv)) return false

  const responses = (first as Record<string, unknown>)['responses']
  if (!Array.isArray(responses)) return false

  // If there are responses, check the first one for Grok-specific fields
  if (responses.length > 0) {
    const firstResp = responses[0]
    if (typeof firstResp !== 'object' || firstResp === null) return false
    if (!('response' in firstResp)) return false
    const resp = (firstResp as Record<string, unknown>)['response']
    if (typeof resp !== 'object' || resp === null) return false
    if (!('_id' in resp) || !('sender' in resp)) return false
  }

  return true
}

/**
 * Parses a Grok conversations export.
 */
export const grokParser: Parser = {
  id: 'grok',
  canParse(content: string): boolean {
    try {
      const data = JSON.parse(content)
      return isGrokShape(data)
    } catch {
      return false
    }
  },

  parse(content: string): ParseResult {
    const data = JSON.parse(content)
    const messages: ParsedMessage[] = []
    const warnings: string[] = []

    if (!isGrokShape(data)) {
      throw new InvalidInputError('Grok export must be an object with a "conversations" array')
    }

    for (const convWrapper of data.conversations) {
      const conv = convWrapper.conversation
      if (!conv || !conv.id) {
        warnings.push('Skipping conversation without id')
        continue
      }

      const conversationId = conv.id

      if (!Array.isArray(convWrapper.responses)) {
        warnings.push(
          `Skipping conversation ${conversationId} without responses array`
        )
        continue
      }

      for (const respWrapper of convWrapper.responses) {
        const resp = respWrapper.response
        if (!resp) {
          warnings.push(
            `Skipping response wrapper without response object in conversation ${conversationId}`
          )
          continue
        }

        const role = mapSender(resp.sender)

        if (!role) {
          warnings.push(
            `Skipping message ${resp._id} with unknown sender "${resp.sender}" in conversation ${conversationId}`
          )
          continue
        }

        // Skip messages without text content
        if (!resp.message || !resp.message.trim()) {
          continue
        }

        // Parse timestamp
        const timestampUtc = parseGrokTimestamp(resp.create_time)
        if (!timestampUtc) {
          warnings.push(
            `Skipping message ${resp._id} with invalid timestamp in conversation ${conversationId}`
          )
          continue
        }

        messages.push({
          source: 'grok',
          sourceConversationId: conversationId,
          sourceMessageId: resp._id,
          timestampUtc,
          role,
          text: resp.message,
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
      source: 'grok',
      messages,
      warnings,
    }
  },
}
