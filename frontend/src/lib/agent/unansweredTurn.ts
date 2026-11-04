import type { UIMessage } from 'ai';

/**
 * A turn the API refused before answering it (a read-only workspace's 402):
 * the thread without the person's last message (and any empty answer begun
 * after it), and that message's text, to put back in the input. Null when the
 * thread doesn't end with their message.
 */
export function takeBackUnansweredTurn(
  messages: UIMessage[],
): { messages: UIMessage[]; text: string } | null {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role === 'assistant' && !messages[end - 1].parts?.length) {
    end -= 1;
  }
  const last = messages[end - 1];
  if (!last || last.role !== 'user') return null;
  const text = (last.parts ?? [])
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return { messages: messages.slice(0, end - 1), text };
}
