'use client';

import { useEffect } from 'react';

/**
 * Marks the open chat read (CHAT-01 agentic update: a chat leaves Agents at
 * work, and its row isn't bold, once its result is read): when it opens, and
 * again when the person leaves it, so an answer that finished while they
 * watched counts as read too. Nothing shows; a failure only means the row
 * stays bold until the next visit.
 */
export function MarkChatRead({ chatId }: { chatId: string }) {
  useEffect(() => {
    const mark = () =>
      fetch(`/api/chat/conversations/${chatId}/read`, { method: 'POST', keepalive: true }).catch(
        () => undefined,
      );
    void mark();
    return () => void mark();
  }, [chatId]);
  return null;
}
