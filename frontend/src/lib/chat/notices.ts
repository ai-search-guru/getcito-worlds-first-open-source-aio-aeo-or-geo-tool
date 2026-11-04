import { isKeyFailureClass, type KeyFailureClass } from '@/lib/agent/keyErrors';
import { isAiProvider, type AiProvider } from '@/lib/agent/providers';
import type { CmsTarget } from '@/lib/content/cmsSendClient';

/**
 * A person's notices from the system (00441, 00446) as the Inbox shows them:
 * their workspace's own AI key fails (AGENT-OWN-KEY §5.3), or its agents
 * reached 80% or all of their monthly limit on it (§4.2 item 4, PR 10); an
 * agent sent a page out on its own, or an edit stopped it from doing so
 * (AUTONOMOUS-GO-LIVE §6.4, §7.2); a scheduled job's run failed after its
 * retry, or the job turned itself off (CHAT-12 items 16, 26–27; 00461).
 * Pure, for the server action that reads them (lib/actions/chatNotices.ts).
 */

interface NoticeBase {
  id: string;
  createdAt: string;
  read: boolean;
}

/** A notice as the Inbox shows it. */
export type ChatNotice =
  | (NoticeBase & {
      kind: 'own_key_failed';
      provider: AiProvider;
      class: KeyFailureClass;
      /** The 3-day reminder of a key still failing. */
      reminder: boolean;
    })
  | (NoticeBase & {
      kind: 'own_key_limit';
      /** 80: agents used 80% of the limit; 100: all of it, and they paused. */
      level: 80 | 100;
      /** This month's estimate when the notice was written, at list prices. */
      usedUsd: number;
      capUsd: number;
      renewsAt: string | null;
    })
  | (NoticeBase & {
      kind: 'agent_went_live';
      /** The agent, by its name then. */
      agent: string;
      /** The page and where it went (AUTONOMOUS-GO-LIVE §6.4): a CMS draft in v1. */
      title: string;
      target: CmsTarget;
      draftId: string;
      /** The run's chat, for Open run; null when it couldn't be found. */
      chatId: string | null;
      /** Published live (PR 9): where; null for a CMS draft. */
      url: string | null;
    })
  | (NoticeBase & {
      kind: 'agent_go_live_off';
      /** An agent an edit stopped from going live on its own (§7.2). */
      agent: string;
      agentId: string;
    })
  | ScheduleNotice;

/**
 * A scheduled job's notice (CHAT-12 items 16, 26–27; 00461): a run failed
 * after its retry, or the job turned itself off, with why in plain words.
 */
export interface ScheduleNotice extends NoticeBase {
  kind: 'schedule_failed' | 'schedule_paused';
  title: string;
  reason: string;
  /** Where Open goes: the job's chat, or Chat when it has none yet. */
  href: `/dashboard/${string}`;
}

/** A row as the Inbox reads it: its kind, what the words need, and whether it was read. */
export interface NoticeRow {
  id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
}

const CMS_TARGETS = ['webflow', 'wordpress', 'framer', 'wix', 'webhook'] as const;
const isCmsTarget = (value: unknown): value is CmsTarget =>
  CMS_TARGETS.some((target) => target === value);

/** The notice a row is, or null for one this Inbox can't show (another kind, a broken payload). */
export function noticeOf(row: NoticeRow): ChatNotice | null {
  const base = { id: row.id, createdAt: row.created_at, read: row.read_at !== null };
  const payload = row.payload ?? {};
  if (row.kind === 'own_key_failed') {
    const { provider, class: cls, reminder } = payload;
    if (!isAiProvider(provider) || !isKeyFailureClass(cls)) return null;
    return { ...base, kind: 'own_key_failed', provider, class: cls, reminder: reminder === true };
  }
  if (row.kind === 'own_key_limit_80' || row.kind === 'own_key_limit_100') {
    const usedUsd = Number(payload.usedUsd);
    const capUsd = Number(payload.capUsd);
    if (!Number.isFinite(usedUsd) || !Number.isFinite(capUsd)) return null;
    return {
      ...base,
      kind: 'own_key_limit',
      level: row.kind === 'own_key_limit_100' ? 100 : 80,
      usedUsd,
      capUsd,
      renewsAt: typeof payload.renewsAt === 'string' ? payload.renewsAt : null,
    };
  }
  if (row.kind === 'agent_went_live') {
    const { agent, title, target, draftId, chatId, kind, url } = payload;
    if (typeof agent !== 'string' || typeof title !== 'string' || typeof draftId !== 'string') {
      return null;
    }
    if (!isCmsTarget(target)) return null;
    return {
      ...base,
      kind: 'agent_went_live',
      agent,
      title,
      target,
      draftId,
      chatId: typeof chatId === 'string' ? chatId : null,
      url: kind === 'publish' && typeof url === 'string' && /^https?:\/\//.test(url) ? url : null,
    };
  }
  if (row.kind === 'agent_go_live_off') {
    const { agent, agentId } = payload;
    if (typeof agent !== 'string' || typeof agentId !== 'string') return null;
    return { ...base, kind: 'agent_go_live_off', agent, agentId };
  }
  if (row.kind === 'schedule_failed' || row.kind === 'schedule_paused') {
    const { title, reason, conversationId } = payload;
    if (typeof title !== 'string' || typeof reason !== 'string') return null;
    const chat =
      typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId)
        ? conversationId
        : null;
    return {
      ...base,
      kind: row.kind,
      title: title.slice(0, 120),
      reason: reason.slice(0, 200),
      href: chat ? `/dashboard/chat/${chat}` : '/dashboard/chat',
    };
  }
  return null;
}

/** The kinds a person closes by opening them (AUTONOMOUS-GO-LIVE §6.4): about an agent, not a key. */
export const OPENED_CLOSES: readonly ChatNotice['kind'][] = [
  'agent_went_live',
  'agent_go_live_off',
];
