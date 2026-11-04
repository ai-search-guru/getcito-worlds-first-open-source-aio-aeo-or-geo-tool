'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Send, X } from 'lucide-react';
import { DenialCard } from '@/components/agentic/DenialCard';
import { requestAccess } from '@/lib/actions/chatAccessRequests';
import type { AgentListItem } from '@/lib/chat/agents';
import type { ChatDenialCard } from '@/lib/chat/events';
import { agentDot } from '@/lib/chat/agentView';
import { cn } from '@/lib/utils';
import type { AgentWords } from './agentWords';

/**
 * Pieces the Agents list and an agent's detail share (governance mockup
 * `#g-agents`, `#g-agent`): the status dot and line, the formula chips
 * (skill · mode · connections · model), the "Publishes on its own" badge
 * and the out-of-permission answer a refused button brings back.
 */

/**
 * An agent that publishes and sends on its own, at most `limit` a day
 * (AUTONOMOUS-GO-LIVE §7.2): its card's and its page's badge.
 */
export function GoLiveBadge({ limit, className }: { limit: number; className?: string }) {
  const t = useTranslations('chatAgents.detail.goLive');
  return (
    <span
      data-slot="agent-go-live-badge"
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-[7px] border border-foreground/20 bg-foreground/[.06] px-[7px] py-0.5 text-[11.5px] leading-[1.35] font-medium text-foreground',
        className,
      )}
    >
      <Send aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{t('badge', { limit })}</span>
    </span>
  );
}

/** The mockup's `.cp` chip. */
export const CHIP =
  'inline-flex max-w-full items-center gap-1 rounded-[7px] border bg-card px-[7px] py-0.5 text-[11.5px] leading-[1.35] text-foreground/80';

/** The status dot (§B item 6): Active green, Paused amber, Draft and Archived grey. */
export function StatusDot({
  status,
  className,
}: {
  status: AgentListItem['status'];
  className?: string;
}) {
  const dot = agentDot(status);
  return (
    <span
      aria-hidden
      data-slot="agent-dot"
      data-dot={dot}
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        dot === 'active' && 'bg-green-600 dark:bg-green-500',
        dot === 'paused' && 'bg-amber-600 dark:bg-amber-400',
        dot === 'idle' && 'bg-foreground/25',
        className,
      )}
    />
  );
}

/** Whether the agent's newest run is working or waiting on someone. */
export function liveRunOf(agent: Pick<AgentListItem, 'status' | 'lastRun'>) {
  if (agent.status === 'archived' || !agent.lastRun) return null;
  if (agent.lastRun.status === 'running') return 'running' as const;
  if (agent.lastRun.status === 'needs_you') return 'needsYou' as const;
  return null;
}

/**
 * "● Active · Next run Mon 07:00", "● Paused · AI limit reached",
 * "● Draft · Not on yet" (mockup `.stl`).
 */
export function StatusLine({
  agent,
  words,
  className,
}: {
  agent: Pick<AgentListItem, 'status' | 'pausedReason' | 'lastRun' | 'triggers'>;
  words: AgentWords;
  className?: string;
}) {
  const t = useTranslations('chatAgents');
  const live = liveRunOf(agent);
  const line =
    agent.status === 'draft'
      ? t('line.draft')
      : agent.status === 'archived'
        ? t('line.archived')
        : agent.status === 'paused'
          ? t(`pausedReason.${agent.pausedReason ?? 'manual'}`)
          : live === 'running'
            ? t('line.running')
            : live === 'needsYou'
              ? t('line.needsYou')
              : words.nextRun(agent.triggers).line;
  const text = `${t(`status.${agent.status}`)} · ${line}`;
  return (
    <span
      data-slot="agent-status"
      data-status={agent.status}
      title={text}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs font-medium',
        agent.status === 'paused' || live === 'needsYou'
          ? 'text-amber-700 dark:text-amber-400'
          : live === 'running'
            ? 'text-foreground'
            : 'text-muted-foreground',
        className,
      )}
    >
      <StatusDot status={agent.status} />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * The agent as chips (mockup `.formula`): its skills, mode, and — where
 * they are known (the detail) — its connections and model.
 */
export function FormulaChips({
  agent,
  words,
  className,
}: {
  agent: Pick<AgentListItem, 'skills' | 'mode'> & {
    connections?: { key: string }[];
    model?: string | null;
  };
  words: AgentWords;
  className?: string;
}) {
  const t = useTranslations('chatAgents');
  const chip = 'shrink-0 rounded-[7px] border bg-muted/50 px-[7px] py-px text-foreground/80';
  const connections = agent.connections;
  const parts = [
    ...agent.skills.map((skill) => `/${skill}`),
    agent.mode ? t(`modes.${agent.mode}`) : null,
    ...(connections ?? []).map((c) => words.connection(c.key)),
    agent.model !== undefined ? words.model(agent.model) : null,
  ].filter(Boolean);
  return (
    <div
      data-slot="agent-formula"
      title={parts.join(' · ')}
      className={cn('flex gap-1 overflow-hidden text-[11.5px] whitespace-nowrap', className)}
    >
      {agent.skills.map((skill) => (
        <span key={skill} className={chip}>
          <code className="font-mono text-[11.5px]">/{skill}</code>
        </span>
      ))}
      {agent.mode && <span className={chip}>{t(`modes.${agent.mode}`)}</span>}
      {connections &&
        (connections.length > 0 ? (
          connections.map((c) => (
            <span key={c.key} className={chip}>
              {words.connection(c.key)}
            </span>
          ))
        ) : (
          <span className={cn(chip, 'text-muted-foreground')}>{t('connections.none')}</span>
        ))}
      {agent.model !== undefined && <span className={chip}>{words.model(agent.model)}</span>}
    </div>
  );
}

/**
 * The out-of-permission answer (CHAT-20 §4c) for a button the server
 * refused, with Ask your Admin, until it is closed or another button is
 * clicked: read out as it appears, and scrolled into view.
 */
export function AgentDenial({ denial, onClose }: { denial: ChatDenialCard; onClose: () => void }) {
  const t = useTranslations('chatAgents');
  const box = useRef<HTMLDivElement>(null);
  // A card clicked far down the list: the answer above comes into view.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, [denial]);
  return (
    <div ref={box} role="alert" data-slot="agent-denial" className="relative mb-4 max-w-[640px]">
      <button
        type="button"
        data-action="denial.close"
        aria-label={t('closeDenial')}
        onClick={onClose}
        className="absolute top-0 right-0 z-10 flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-4" aria-hidden />
      </button>
      <DenialCard
        title={t('deniedTitle')}
        asked={denial.asked}
        why={denial.rule.detail}
        whySource={denial.rule.source}
        whoCan={denial.whoCan}
        nextActions={denial.nextActions}
        onAskAdmin={async () => {
          const sent = await requestAccess({
            asked: denial.asked.slice(0, 500),
            ruleKind: denial.rule.kind,
            ruleDetail: denial.rule.detail.slice(0, 500),
          });
          if (!sent.ok) throw new Error(sent.reason);
        }}
      />
    </div>
  );
}
