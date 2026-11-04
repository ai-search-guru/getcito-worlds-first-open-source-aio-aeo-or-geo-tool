'use client';

import { useEffect } from 'react';

/**
 * Agent Center was opened in this browser: the chat menu's "New" pill beside
 * it is gone (CHAT-21 §A item 1). Opening any of its pages counts, from the
 * left menu, the chat menu or a link. The key is the one it had under Chat.
 */
const AGENTS_SEEN_KEY = 'getcito.chatMenu.agentsSeen';

export function readAgentsSeen(): boolean {
  try {
    return window.localStorage.getItem(AGENTS_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAgentsSeen() {
  try {
    window.localStorage.setItem(AGENTS_SEEN_KEY, '1');
  } catch {
    // Private windows and full storage: the pill shows again next visit.
  }
}

/** On Agent Center's pages: marks it seen once one shows. Renders nothing. */
export function AgentsSeen() {
  useEffect(() => saveAgentsSeen(), []);
  return null;
}
