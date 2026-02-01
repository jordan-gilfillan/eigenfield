/**
 * ChatGPT Export Parser
 *
 * Parses the ChatGPT data export format (conversations.json).
 *
 * ChatGPT export structure:
 * [
 *   {
 *     "title": "Conversation Title",
 *     "create_time": 1234567890.123,
 *     "update_time": 1234567890.456,
 *     "mapping": {
 *       "<node_id>": {
 *         "id": "<node_id>",
 *         "message": {
 *           "id": "<message_id>",
 *           "author": { "role": "user" | "assistant" | "system" | "tool" },
 *           "create_time": 1234567890.123,
 *           "content": {
 *             "content_type": "text",
 *             "parts": ["message text"]
 *           }
 *         },
 *         "parent": "<parent_node_id>" | null,
 *         "children": ["<child_node_id>"]
 *       }
 *     },
 *     "conversation_id": "<conversation_id>"
 *   }
 * ]
 */

import type { Parser, ParseResult, ParsedMessage } from './types'
import type { RoleApi } from '../enums'

// ChatGPT export types
interface ChatGPTAuthor {
  role: string
  name?: string
  metadata?: Record<string, unknown>
}

interface ChatGPTContent {
  content_type: string
  parts?: (string | Record<string, unknown>)[]
  text?: string
}

interface ChatGPTMessage {
  id: string
  author: ChatGPTAuthor
  create_time: number | null
  update_time?: number | null
  content: ChatGPTContent
  status?: string
  metadata?: Record<string, unknown>
}

interface ChatGPTNode {
  id: string
  message: ChatGPTMessage | null
  parent: string | null
  children: string[]
}

interface ChatGPTConversation {
  title: string
  create_time: number
  update_time: number
  mapping: Record<string, ChatGPTNode>
  conversation_id: string
}

/**
 * Extracts text content from a ChatGPT message content object.
 */
function extractTextContent(content: ChatGPTContent): string {
  if (content.content_type === 'text' && content.parts) {
    // Filter to only string parts (skip images, etc.)
    const textParts = content.parts.filter(
      (part): part is string => typeof part === 'string'
    )
    return textParts.join('\n')
  }

  if (content.text) {
    return content.text
  }

  return ''
}

/**
 * Maps ChatGPT role to our normalized role.
 * Returns null for roles we don't track (system, tool).
 */
function mapRole(chatgptRole: string): RoleApi | null {
  switch (chatgptRole) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    default:
      // Skip system messages, tool calls, etc.
      return null
  }
}

/**
 * Parses a ChatGPT conversations.json export.
 */
export const chatgptParser: Parser = {
  canParse(content: string): boolean {
    try {
      const data = JSON.parse(content)
      // ChatGPT export is an array of conversations with mapping property
      if (!Array.isArray(data)) return false
      if (data.length === 0) return true // Empty export is valid
      const first = data[0]
      return (
        typeof first === 'object' &&
        first !== null &&
        'mapping' in first &&
        'conversation_id' in first
      )
    } catch {
      return false
    }
  },

  parse(content: string): ParseResult {
    const data = JSON.parse(content) as ChatGPTConversation[]
    const messages: ParsedMessage[] = []
    const warnings: string[] = []

    if (!Array.isArray(data)) {
      throw new Error('ChatGPT export must be an array of conversations')
    }

    for (const conversation of data) {
      if (!conversation.mapping || !conversation.conversation_id) {
        warnings.push(
          `Skipping conversation without mapping or conversation_id`
        )
        continue
      }

      const conversationId = conversation.conversation_id

      // Process each node in the mapping
      for (const node of Object.values(conversation.mapping)) {
        if (!node.message) continue

        const msg = node.message
        const role = mapRole(msg.author.role)

        // Skip non-user/assistant messages
        if (!role) continue

        // Skip messages without content
        const text = extractTextContent(msg.content)
        if (!text.trim()) continue

        // Skip messages without timestamps
        if (msg.create_time === null || msg.create_time === undefined) {
          warnings.push(
            `Skipping message ${msg.id} without timestamp in conversation ${conversationId}`
          )
          continue
        }

        // ChatGPT timestamps are Unix seconds (float)
        const timestampUtc = new Date(msg.create_time * 1000)

        messages.push({
          source: 'chatgpt',
          sourceConversationId: conversationId,
          sourceMessageId: msg.id,
          timestampUtc,
          role,
          text,
        })
      }
    }

    // Sort by timestamp for consistent ordering
    messages.sort(
      (a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime()
    )

    return {
      source: 'chatgpt',
      messages,
      warnings,
    }
  },
}
