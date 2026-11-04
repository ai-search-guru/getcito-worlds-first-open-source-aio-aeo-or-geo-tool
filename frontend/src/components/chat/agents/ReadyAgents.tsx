'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { AgentAvatar } from '@/components/agentic/AgentAvatar';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { presetTriggerDraft, triggerInputOf } from '@/lib/chat/agentForm';
import {
  AGENT_PRESETS,
  filterPresets,
  presetFilterOptions,
  presetFit,
  type AgentPreset,
  type PresetFilter,
  type PresetFit,
  type PresetLock,
} from '@/lib/chat/agents/catalog';
import { siteTypeOf } from '@/lib/content/pageTypes';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { FormulaChips } from './AgentParts';
import type { AgentWords } from './agentWords';

/**
 * Agent Center › Ready to use (AGENTS plan §1, §3; CHAT-21 §D item 15): the
 * ready-to-use agents as cards in the Agents list's style, ready ones
 * first. Each says what it does, its skills, triggers and mode, and the
 * plan its mode needs where the workspace's plan keeps it closed. **Use
 * this agent** opens New agent filled with it; nothing is saved or turned
 * on until the person does it there. A Soon card says what it waits for and
 * opens nothing. Analysts and Agency partners see the cards with the line
 * the list gives them. Filters: the goal, and business type, industry and
 * role once a preset carries one. The agents made for the site type of the
 * brand on screen, or for one of the person's work areas, come first in
 * their group, marked For your site type or For your role.
 */

const FILTER_KEYS: Record<PresetFilter, string> = {
  goal: 'goals',
  businessType: 'businessTypes',
  industry: 'industries',
  role: 'roles',
};

const LIST_FORMAT = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

/** A filter chip (the list's `.fc`). */
function FilterChip({
  on,
  onClick,
  children,
  filter,
  value,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
  filter: PresetFilter;
  value: string;
}) {
  return (
    <button
      type="button"
      data-action="agents.readyFilter"
      data-filter={filter}
      data-value={value}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on && 'border-foreground bg-foreground text-background hover:bg-foreground/90',
      )}
    >
      {children}
    </button>
  );
}

function PresetCard({
  preset,
  lock,
  fit,
  writer,
  words,
}: {
  preset: AgentPreset;
  lock: PresetLock | undefined;
  fit: PresetFit | null;
  writer: boolean;
  words: AgentWords;
}) {
  const t = useTranslations('chatAgents.ready');
  const tAgents = useTranslations('chatAgents');
  const name = tAgents(`presets.${preset.id}.name`);
  const ready = preset.status === 'ready';
  // Its triggers in the list's words; their clock doesn't show, so any zone reads the same.
  const triggers = preset.triggers
    .map((trigger, i) => triggerInputOf(presetTriggerDraft(trigger, `k${i}`, 'UTC')))
    .filter((input) => input !== null)
    .map((input) => words.trigger(input));
  const triggerLine = triggers.length > 0 ? triggers.join(' · ') : tAgents('trigger.manualOnly');
  const needs = LIST_FORMAT.format(preset.needs.map((need) => t(`needs.${need}`)));

  return (
    <article
      data-slot="preset-card"
      data-preset={preset.id}
      data-status={preset.status}
      data-fit={fit ?? undefined}
      aria-label={name}
      className={cn(
        'flex min-w-0 flex-col gap-[9px] rounded-[14px] border bg-card p-3.5 shadow-[0_1px_2px_rgba(10,10,10,.04)]',
        ready &&
          'transition-[box-shadow,border-color] duration-200 hover:border-foreground/20 hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] motion-reduce:transition-none',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar tone="muted" decorative />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={name}>
          {name}
        </h3>
        {fit && (
          <span
            data-slot="preset-fit"
            className="shrink-0 rounded-full bg-green-100 px-2 py-px text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            {t(`fit.${fit}`)}
          </span>
        )}
      </div>

      <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
        {tAgents(`presets.${preset.id}.description`)}
      </p>

      {/* On a card, a long formula wraps rather than cutting the mode off. */}
      <FormulaChips
        agent={{ skills: preset.skills, mode: preset.mode }}
        words={words}
        className="flex-wrap"
      />
      {ready && lock && (
        <span
          data-slot="preset-lock"
          title={t('fallbackTip')}
          className="inline-flex w-fit max-w-full items-center gap-1 rounded-full bg-muted px-2 py-px text-[11px] text-foreground/70"
        >
          <Lock className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {lock.kind === 'plan'
              ? tAgents('form.mode.lockTag', { plan: lock.plan, current: lock.current })
              : t('policyLock')}
          </span>
        </span>
      )}

      {(ready || triggers.length > 0) && (
        <div data-cell="trigger" className="min-w-0 text-xs text-muted-foreground">
          {tAgents('list.cells.trigger')}
          <b className="block truncate font-medium text-foreground" title={triggerLine}>
            {triggerLine}
          </b>
        </div>
      )}

      <div className="mt-auto flex min-w-0 items-center gap-1.5 border-t pt-2.5">
        {!ready ? (
          <span data-slot="preset-soon" className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-medium text-foreground/70">
              {t('soon')}
            </span>
            <span
              className="truncate text-muted-foreground"
              title={t('needsLine', { what: needs })}
            >
              {t('needsLine', { what: needs })}
            </span>
          </span>
        ) : writer ? (
          <Link
            href={`/dashboard/agents/new?preset=${preset.id}`}
            data-action="agents.usePreset"
            aria-label={t('useLabel', { name })}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('use')}
          </Link>
        ) : (
          <span
            data-slot="preset-read-only"
            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Lock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tAgents('list.readOnly.detail')}</span>
          </span>
        )}
      </div>
    </article>
  );
}

export function ReadyAgents({
  locks,
  writer,
  words,
  workAreas = [],
  presets = AGENT_PRESETS,
}: {
  locks: Record<string, PresetLock>;
  /** Admins and Managers: they make agents. */
  writer: boolean;
  words: AgentWords;
  /** The person's work areas (Settings › Menu access). */
  workAreas?: readonly string[];
  /** The catalog; a test's own list otherwise. */
  presets?: readonly AgentPreset[];
}) {
  const t = useTranslations('chatAgents.ready');
  const options = useMemo(() => presetFilterOptions(presets), [presets]);
  const [picked, setPicked] = useState<Partial<Record<PresetFilter, string | null>>>({});
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  // The brand on screen's site type, guessed while it isn't set; none before the brands load.
  const viewer = { siteType: activeBrand ? siteTypeOf(activeBrand) : null, workAreas };
  const shown = filterPresets(presets, picked, viewer);
  const pick = (filter: PresetFilter, value: string | null) =>
    setPicked((was) => ({ ...was, [filter]: value }));

  return (
    <div>
      <div className="my-3 flex flex-col gap-1.5">
        {options.map(({ filter, values }) => (
          <div
            key={filter}
            role="group"
            aria-label={t(`filters.${filter}`)}
            className="flex flex-wrap items-center gap-1.5"
          >
            {options.length > 1 && (
              <span className="mr-0.5 text-[11.5px] text-muted-foreground">
                {t(`filters.${filter}`)}
              </span>
            )}
            <FilterChip
              filter={filter}
              value=""
              on={!picked[filter]}
              onClick={() => pick(filter, null)}
            >
              {t('all')}
            </FilterChip>
            {values.map((value) => (
              <FilterChip
                key={value}
                filter={filter}
                value={value}
                on={picked[filter] === value}
                onClick={() => pick(filter, value)}
              >
                {t(`${FILTER_KEYS[filter]}.${value}`)}
              </FilterChip>
            ))}
          </div>
        ))}
      </div>

      <div
        data-slot="presets-grid"
        className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3"
      >
        {shown.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            lock={locks[preset.id]}
            fit={presetFit(preset, viewer)}
            writer={writer}
            words={words}
          />
        ))}
      </div>
    </div>
  );
}
