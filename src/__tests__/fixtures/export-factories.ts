/**
 * Shared test fixture factories for ChatGPT export format.
 */

/** Creates a minimal valid ChatGPT export JSON string. */
export function createTestExport(messages: Array<{
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: number
  conversationId?: string
}>) {
  const mapping: Record<string, unknown> = {}

  messages.forEach((msg, i) => {
    mapping[`node-${i}`] = {
      id: `node-${i}`,
      message: {
        id: msg.id,
        author: { role: msg.role },
        create_time: msg.timestamp,
        content: {
          content_type: 'text',
          parts: [msg.text],
        },
      },
      parent: i > 0 ? `node-${i - 1}` : null,
      children: i < messages.length - 1 ? [`node-${i + 1}`] : [],
    }
  })

  return JSON.stringify([
    {
      title: 'Test Conversation',
      create_time: messages[0]?.timestamp ?? 1705316400,
      update_time: messages[messages.length - 1]?.timestamp ?? 1705316400,
      mapping,
      conversation_id: messages[0]?.conversationId ?? 'conv-test',
    },
  ])
}
