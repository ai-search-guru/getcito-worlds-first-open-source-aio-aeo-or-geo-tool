'use client';

import { useContext, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, Plus } from 'lucide-react';
import { AskAdminButton } from '@/components/chat-access/AskAdminButton';
import { RoleContext } from '@/components/context/RoleProvider';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import type { PresetLock } from '@/lib/chat/agents/catalog';
import { AGENT_CENTER_TABS, writesAgents, type AgentCenterTab } from '@/lib/chat/agentView';
import { cn } from '@/lib/utils';
import { AgentsList } from './AgentsList';
import { useAgentWords } from './agentWords';
import { ReadyAgents } from './ReadyAgents';

/**
 * Agent Center (CHAT-21 §B; governance mockup `#g-agents`; AGENTS plan §1),
 * its own page under Chat on the menu: the title with the count of agents
 * on, the formula and New agent, then two tabs. **Ready to use**, first:
 * the ready-to-use agents (ReadyAgents.tsx). **Your agents**: the agents
 * the person may see (AgentsList.tsx), with Mine · Workspace · Paused ·
 * Archived inside it. The tab is kept in the address (`?tab=ready|yours`),
 * Ready to use without one. Both stay mounted, so a tab keeps its search
 * and filters, and the count shows from the start. Analysts and Agency
 * partners read, with a line that says so and Ask your Admin.
 */

export function AgentCenter({
  initialTab = 'ready',
  locks = {},
  workAreas = [],
  now: nowProp,
  timeZone,
}: {
  initialTab?: AgentCenterTab;
  /** Ready presets whose mode the workspace's plan or Settings › Chat keeps closed. */
  locks?: Record<string, PresetLock>;
  /** The person's work areas: Ready to use puts the agents made for them first. */
  workAreas?: readonly string[];
  now?: Date;
  timeZone?: string;
}) {
  const t = useTranslations('chatAgents.center');
  const tList = useTranslations('chatAgents.list');
  const tRoles = useTranslations('chatAccess.roleNames');
  const { role } = useContext(RoleContext);
  const writer = writesAgents(role);
  const [tab, setTab] = useState<AgentCenterTab>(initialTab);
  const [summary, setSummary] = useState<{ active: number; activeLimit: number | null } | null>(
    null,
  );
  // The cards' triggers read the same on any clock: one for the page.
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const words = useAgentWords(now, timeZone);

  const switchTab = (next: AgentCenterTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    } catch {
      // The address only remembers the tab; the page works without it.
    }
  };

  return (
    <div className="max-w-[1100px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.4px]">{tList('title')}</h1>
        {summary && (
          <span
            data-slot="agents-count"
            title={tList('activeTip', {
              active: summary.active,
              limit: summary.activeLimit === null ? 'none' : String(summary.activeLimit),
            })}
            className="rounded-md bg-muted px-1.5 text-[11.5px] font-medium text-foreground/70 tabular-nums"
          >
            {summary.active}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div
            title={tList('formulaTip')}
            className="flex items-center gap-1 text-[11.5px] text-muted-foreground max-[900px]:hidden"
          >
            {(['skill', 'mode', 'connections', 'model'] as const).map((part, i) => (
              <span key={part} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden>+</span>}
                <span className="rounded-[7px] border bg-muted/50 px-[7px] py-px text-foreground/80">
                  {tList(`formula.${part}`)}
                </span>
              </span>
            ))}
          </div>
          {writer && (
            <Link
              href="/dashboard/agents/new"
              data-action="agents.new"
              className={buttonVariants({ variant: 'default' })}
            >
              <Plus aria-hidden />
              {tList('newAgent')}
            </Link>
          )}
        </div>
      </div>

      {!writer && (
        <div
          role="note"
          data-slot="agents-read-only"
          className="mb-3 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-[13px]"
        >
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <b className="font-semibold">{tList('readOnly.title', { role: tRoles(role) })}</b>
            <em className="ml-1.5 text-muted-foreground not-italic">{tList('readOnly.detail')}</em>
          </div>
          <AskAdminButton asked={tList('readOnly.asked')} ruleKind="role" />
        </div>
      )}

      <div
        role="tablist"
        aria-label={tList('title')}
        className="flex gap-[18px] border-b text-[13.5px]"
      >
        {AGENT_CENTER_TABS.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            id={`agent-center-tab-${view}`}
            aria-controls={`agent-center-panel-${view}`}
            aria-selected={tab === view}
            data-action="agents.tab"
            data-tab={view}
            onClick={() => switchTab(view)}
            className={cn(
              'py-2 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tab === view &&
                'font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]',
            )}
          >
            {t(`tabs.${view}`)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="agent-center-panel-ready"
        aria-labelledby="agent-center-tab-ready"
        data-slot="agent-center-ready"
        hidden={tab !== 'ready'}
      >
        <ReadyAgents locks={locks} writer={writer} words={words} workAreas={workAreas} />
      </div>
      <div
        role="tabpanel"
        id="agent-center-panel-yours"
        aria-labelledby="agent-center-tab-yours"
        data-slot="agent-center-yours"
        hidden={tab !== 'yours'}
      >
        <AgentsList now={nowProp} timeZone={timeZone} onSummary={setSummary} />
      </div>
    </div>
  );
}
