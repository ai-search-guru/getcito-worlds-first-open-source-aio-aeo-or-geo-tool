'use client';

import { useTranslations } from 'next-intl';
import { ListDot } from '@/components/agentic/ListDot';
import { Badge } from '@/components/ui/badge';
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import type { AgentState, DraftMethod, DraftStatus } from '@/lib/content/drafts';

/**
 * A draft's status and method, as the Library and the editor show them
 * (Content Editor spec: Draft grey, In review amber, Ready green, Published
 * blue; Create blue, Optimize amber). Colors as Action Center's badges.
 */

export const DRAFT_STATUS_BADGE: Record<DraftStatus, string> = {
  draft: 'border-border bg-muted/50 text-muted-foreground',
  in_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ready: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  published: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
};

export const DRAFT_METHOD_BADGE: Record<DraftMethod, string> = {
  create: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  optimize: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
};

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  const t = useTranslations('contentEditor.status');
  return (
    <Badge variant="outline" className={DRAFT_STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(status)}
    </Badge>
  );
}

export function DraftMethodBadge({
  method,
  className,
}: {
  method: DraftMethod;
  className?: string;
}) {
  const t = useTranslations('contentEditor.method');
  return (
    <Badge variant="outline" className={cn(DRAFT_METHOD_BADGE[method], className)}>
      {t(method)}
    </Badge>
  );
}

/** Where the Content Agent is on a draft Start gave it (CE-015): writing, or couldn't finish. */
export function AgentStateBadge({ state }: { state: Exclude<AgentState, null> }) {
  const t = useTranslations('contentEditor.agentState');
  return (
    <Badge
      variant="outline"
      className={
        state === 'writing'
          ? 'border-border bg-muted/50 text-muted-foreground'
          : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
      }
    >
      {state === 'writing' && <LoadingDots />}
      {t(state)}
    </Badge>
  );
}

/**
 * The agent's state as Chat lists a run (Chat agentic plan §2, "List status
 * dot"), with the new Chat on: the running dot while it writes, the red one
 * once it failed, and the same words beside it.
 */
export function AgentStateLine({ state }: { state: Exclude<AgentState, null> }) {
  const t = useTranslations('contentEditor.agentState');
  return (
    <span
      data-slot="agent-state-line"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        state === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
      )}
    >
      <ListDot state={state === 'writing' ? 'running' : 'failed'} decorative />
      {t(state)}
    </span>
  );
}
