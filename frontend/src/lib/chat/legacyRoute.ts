import { NextResponse } from 'next/server';
import { chatAgenticEnabled } from './flag';

/**
 * Today's Agent Chat lives at /dashboard/agent. With the new Chat on for the
 * workspace (CHAT_AGENTIC), that address and every one under it move to the
 * matching /dashboard/chat address with a 301, the query kept, so old links
 * and bookmarks open Chat (CHAT-01 item 2). With it off, nothing moves.
 */

/** `/dashboard/agent/{rest}` → `/dashboard/chat/{rest}`; null for any other path. */
export function chatPathOfAgentPath(pathname: string): string | null {
  const match = /^\/dashboard\/agent(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const rest = (match[1] ?? '').replace(/\/+$/, '');
  return `/dashboard/chat${rest}`;
}

/**
 * Whether the new Chat is on for this person, asking for their workspace
 * only when CHAT_AGENTIC_ORGS narrows it to some (`organizationOf`). Off for
 * the whole deployment: no read at all.
 */
export async function chatAgenticForUser(
  organizationOf: () => Promise<string | null>,
): Promise<boolean> {
  if (process.env.CHAT_AGENTIC !== 'true') return false;
  // On for every workspace: no need to know which one this is.
  if (chatAgenticEnabled(null)) return true;
  return chatAgenticEnabled(await organizationOf());
}

/**
 * Agent Chat's API (/api/agent/chat, /api/agent/conversations and each
 * conversation) where the new Chat is on for the workspace: gone, a 404, as
 * the new Chat's own routes answer where it is off. An Agent Chat tab left
 * open, or a direct call, can't run a turn on the workspace's own key past
 * the new Chat's rules (own keys on Enterprise, roles, approvals); its chats
 * were copied into the new Chat (W1-02). Null with it off: the route goes on
 * as before.
 */
export function legacyAgentApiGone(organizationId: string | null): NextResponse | null {
  if (!chatAgenticEnabled(organizationId)) return null;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
