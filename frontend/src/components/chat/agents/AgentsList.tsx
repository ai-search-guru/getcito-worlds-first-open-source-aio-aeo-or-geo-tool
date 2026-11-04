'use client';

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { AgentAvatar } from '@/components/agentic/AgentAvatar';
import { ListDot } from '@/components/agentic/ListDot';
import { RoleContext } from '@/components/context/RoleProvider';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/i18n/navigation';
import type { AgentListView } from '@/lib/chat/agentRules';
import type { AgentListItem, AgentListResult } from '@/lib/chat/agents';
import {
  AGENT_TABS,
  averageShare,
  barWidth,
  percentOf,
  runDot,
  writesAgents,
} from '@/lib/chat/agentView';
import { cn } from '@/lib/utils';
import { AgentDenial, FormulaChips, GoLiveBadge, StatusLine, liveRunOf } from './AgentParts';
import { readAgents } from './agentRequests';
import { AgentsKeyBanner } from '@/components/chat/OwnKeyNotice';
import { useAgentWords, type AgentWords } from './agentWords';
import { useAgentActions } from './useAgentActions';

/**
 * Agent Center's Your agents tab (CHAT-21 §B; governance mockup `#g-agents`;
 * CHAT-27 item 24; AgentCenter.tsx holds the title, New agent and the
 * tabs): the agents the person may see, under Mine · Workspace · Paused ·
 * Archived with their counts, and a search by name or skill. One card per
 * agent: its state, skills and mode, its triggers in short, next run,
 * scope, last run, the last 30 days' outcomes and its AI use as a share of
 * the monthly limit with a thin bar. Each card's Run now and Pause / Resume
 * are the ones the server's `can` gives the row. Analysts and Agency
 * partners read, and start on Workspace.
 */

/** The search asks once the typing stops. */
const SEARCH_DELAY_MS = 250;

/** The mockup's `.btn.sm`, as a link. */
const SMALL_LINK = buttonVariants({ variant: 'outline', size: 'sm' });

type ListState =
  | { status: 'loading'; data: AgentListResult | null }
  | { status: 'ready'; data: AgentListResult }
  | { status: 'error'; data: AgentListResult | null };

/** "AI use · 30 days": the share with a thin bar; its runs, average and cap on hover (CHAT-27 item 24). */
function AiUseCell({ agent }: { agent: AgentListItem }) {
  const t = useTranslations('chatAgents.list');
  const usage = agent.usage30d;
  if (!usage) {
    return <b className="block font-medium text-foreground">{t('none')}</b>;
  }
  const share = percentOf(usage.share);
  const tip = t('aiUseTip', {
    runs: usage.runs,
    average: percentOf(averageShare(usage.share, usage.runs)),
    cap: percentOf(agent.maxRunShare),
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            data-slot="agent-ai-use"
            aria-label={t('aiUseLabel', { share })}
            className="block rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        }
      >
        <b className="block font-medium text-foreground tabular-nums">{share}</b>
        <span
          aria-hidden
          className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-muted"
        >
          <span
            data-slot="agent-ai-use-bar"
            className="block h-full rounded-full bg-foreground/70"
            style={{ width: `${barWidth(usage.share)}%` }}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="block">{tip}</span>
        {usage.ownKeyShare > 0 && (
          <span className="block">{t('ownKey', { share: percentOf(usage.ownKeyShare) })}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function AgentCard({
  agent,
  words,
  actions,
}: {
  agent: AgentListItem;
  words: AgentWords;
  actions: ReturnType<typeof useAgentActions>;
}) {
  const t = useTranslations('chatAgents');
  const tList = useTranslations('chatAgents.list');
  const can = agent.can;
  const live = liveRunOf(agent);
  const href = `/dashboard/agents/${agent.id}`;
  const next = words.nextRun(agent.triggers);
  const outcomes = words.outcomes(agent.outcomes30d);
  const cell = (label: string, value: ReactNode, slot: string) => (
    <div data-cell={slot} className="min-w-0">
      {label}
      {value}
    </div>
  );
  const value = (text: string) => (
    <b className="block truncate font-medium text-foreground" title={text}>
      {text}
    </b>
  );

  return (
    <article
      data-slot="agent-card"
      data-status={agent.status}
      aria-label={agent.name}
      className="flex min-w-0 flex-col gap-[9px] rounded-[14px] border bg-card p-3.5 shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-[box-shadow,border-color] duration-200 hover:border-foreground/20 hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar
          tone="muted"
          decorative
          state={live === 'running' ? 'working' : live === 'needsYou' ? 'waiting' : 'idle'}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={href}
            data-action="agents.open"
            className="block truncate text-sm font-semibold outline-none hover:underline focus-visible:underline"
            title={agent.name}
          >
            {agent.name}
          </Link>
          <StatusLine agent={agent} words={words} />
        </div>
        {agent.ownerInitials && (
          <span
            title={agent.mine ? t('detail.you') : t('detail.owner')}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10.5px] font-semibold text-foreground/70"
          >
            {agent.ownerInitials}
          </span>
        )}
      </div>

      <FormulaChips agent={agent} words={words} />
      {agent.goLiveLimit !== undefined && (
        <GoLiveBadge limit={agent.goLiveLimit} className="w-fit" />
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {cell(tList('cells.trigger'), value(words.triggersShort(agent.triggers)), 'trigger')}
        {cell(
          tList('cells.nextRun'),
          value(agent.status === 'active' ? next.short : tList('none')),
          'nextRun',
        )}
        {cell(tList('cells.scope'), value(words.scope(agent.scope)), 'scope')}
        {cell(
          tList('cells.lastRun'),
          agent.lastRun ? (
            <b className="flex min-w-0 items-center gap-1 font-medium text-foreground">
              <ListDot state={runDot(agent.lastRun.status)} className="-ml-1" />
              <span className="truncate">{words.when(agent.lastRun.at)}</span>
            </b>
          ) : (
            value(tList('none'))
          ),
          'lastRun',
        )}
        {cell(tList('cells.outcomes'), value(outcomes ?? tList('noOutcomes')), 'outcomes')}
        {cell(tList('cells.aiUse'), <AiUseCell agent={agent} />, 'aiUse')}
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t pt-2.5">
        {can.run && (
          <Button
            size="sm"
            variant="outline"
            data-action="agents.run"
            disabled={actions.isBusy(agent.id)}
            onClick={() => void actions.act(agent, 'run')}
          >
            {t('actions.runNow')}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {(can.pause || can.resume) && (
            <Button
              size="sm"
              variant="ghost"
              data-action="agents.pauseResume"
              disabled={actions.isBusy(agent.id)}
              onClick={() => void actions.act(agent, can.pause ? 'pause' : 'resume')}
              className="text-muted-foreground"
            >
              {can.pause ? t('actions.pause') : t('actions.resume')}
            </Button>
          )}
          <Link href={href} data-action="agents.open" className={SMALL_LINK}>
            {t('actions.open')}
          </Link>
        </div>
      </div>
    </article>
  );
}

export function AgentsList({
  now: nowProp,
  timeZone,
  onSummary,
}: {
  now?: Date;
  timeZone?: string;
  /** The agents on and the plan's most, for Agent Center's count beside its title. */
  onSummary?: (summary: { active: number; activeLimit: number | null }) => void;
}) {
  const tList = useTranslations('chatAgents.list');
  const { role } = useContext(RoleContext);
  const writer = writesAgents(role);
  // Analysts and Agency partners own no agents: they start on the workspace's.
  const [tab, setTab] = useState<AgentListView>(writer ? 'mine' : 'workspace');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [list, setList] = useState<ListState>({ status: 'loading', data: null });
  // Read again after a button: the tab and search shown then, not those of the click.
  const [reloads, setReloads] = useState(0);
  // Only the newest read lands: a slower, older one is dropped.
  const asked = useRef(0);

  const load = useCallback(async (view: AgentListView, search: string) => {
    const ask = ++asked.current;
    setList((was) => ({ status: 'loading', data: was.data }));
    const read = await readAgents(view, search);
    if (ask !== asked.current) return;
    setList((was) =>
      read ? { status: 'ready', data: read } : { status: 'error', data: was.data },
    );
  }, []);

  useEffect(() => {
    // "/winback" finds the agents with the /winback skill: skills are kept without the slash.
    const timer = setTimeout(() => setQ(query.trim().replace(/^\/+/, '')), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    // The tab, read from the API (with its loading state) whenever the tab or search changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(tab, q);
  }, [load, tab, q, reloads]);

  // A fresh clock with every read, so "Today" and "Next run" stay right.
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useAgentWords(now, timeZone);
  const actions = useAgentActions(words, {
    onChanged: () => setReloads((n) => n + 1),
    onRan: () => setReloads((n) => n + 1),
  });

  const data = list.data;
  const loading = list.status === 'loading' && !data;
  const agents = data?.agents ?? [];

  useEffect(() => {
    if (data) onSummary?.({ active: data.active, activeLimit: data.activeLimit });
  }, [data, onSummary]);

  return (
    <div>
      {data?.keyFailure && <AgentsKeyBanner failing={data.keyFailure} />}

      {actions.denial && <AgentDenial denial={actions.denial} onClose={actions.clearDenial} />}

      <div className="my-3 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          data-action="agents.search"
          aria-label={tList('search')}
          placeholder={tList('search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 min-w-[220px] rounded-lg border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />
        <div role="group" aria-label={tList('tabsLabel')} className="flex flex-wrap gap-1.5">
          {AGENT_TABS.map((view) => (
            <button
              key={view}
              type="button"
              data-action="agents.filter"
              data-tab={view}
              aria-pressed={tab === view}
              onClick={() => setTab(view)}
              className={cn(
                'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                tab === view &&
                  'border-foreground bg-foreground text-background hover:bg-foreground/90',
              )}
            >
              {tList(`tabs.${view}`)}
              {data && (
                <i
                  data-slot="tab-count"
                  className={cn(
                    'ml-1 rounded-md px-[5px] text-[11px] font-medium not-italic tabular-nums',
                    tab === view ? 'bg-background/20' : 'bg-foreground/10 text-foreground/80',
                  )}
                >
                  {data.counts[view].toLocaleString('en-US')}
                </i>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[214px] w-full rounded-[14px]" />
          ))}
        </div>
      )}

      {list.status === 'error' && (
        <p
          role="alert"
          data-slot="agents-error"
          className="rounded-[14px] border px-3.5 py-7 text-center text-[13px] text-muted-foreground"
        >
          {tList('loadFailed')}{' '}
          <button
            type="button"
            data-action="agents.retry"
            onClick={() => setReloads((n) => n + 1)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {tList('retry')}
          </button>
        </p>
      )}

      {list.status !== 'error' && data && agents.length > 0 && (
        <div
          data-slot="agents-grid"
          aria-busy={list.status === 'loading' || undefined}
          className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3"
        >
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} words={words} actions={actions} />
          ))}
        </div>
      )}

      {list.status === 'ready' && agents.length === 0 && (
        <div
          data-slot="agents-empty"
          className="rounded-[14px] border px-3.5 py-7 text-center text-[13px] text-muted-foreground"
        >
          <AgentAvatar tone="muted" decorative className="mx-auto mb-2" />
          <b className="block font-medium text-foreground">{tList('empty.title')}</b>
          <span className="mt-0.5 block">
            {q
              ? tList('empty.match', { q })
              : tab === 'mine' && !writer
                ? tList('empty.mineReadOnly')
                : tList(`empty.${tab}`)}
          </span>
          {q && (
            <Button
              size="sm"
              variant="outline"
              data-action="agents.showAll"
              className="mt-3"
              onClick={() => setQuery('')}
            >
              {tList('empty.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
