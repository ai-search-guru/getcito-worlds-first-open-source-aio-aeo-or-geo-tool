'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import { KPI_KEYS } from '@/lib/kpis/registry';
import { MAX_AGENT_TRIGGERS } from '@/lib/chat/agentRules';
import {
  SCHEDULE_REPEATS,
  draftNextFire,
  parseList,
  triggerError,
  triggerInputOf,
  type AgentFormSetup,
  type AgentFormState,
  type ScheduleRepeat,
  type StepProblems,
  type TriggerDraft,
  type TriggerKind,
} from '@/lib/chat/agentForm';
import { engineName } from '@/lib/chat/agentView';
import { dayIn } from '@/lib/timeZone';
import { cn } from '@/lib/utils';
import type { AgentWords } from './agentWords';

/**
 * The create flow's step 2 (CHAT-21 §D, §E; governance mockup
 * `#g-agent-new` pane 2): the agent's triggers, up to 5, each with its next
 * run or when it fires; the trigger types as the mockup's options, which
 * set the selected trigger's kind (Manual: none, Run now only); and the
 * rule box — WHEN or EVERY for the selected trigger, FOR the scope (brands,
 * platforms, and topics, prompt tags and URLs that narrow it), THEN Run
 * agent.
 */

/** The mockup's `.opt`, in both themes. */
export const OPT =
  'relative flex min-w-0 flex-col gap-[3px] rounded-xl border bg-card px-3 py-2.5 text-left text-[13px] outline-none transition-[border-color,box-shadow] hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none';
export const OPT_ON = 'border-foreground ring-1 ring-foreground hover:border-foreground';
export const OPT_OFF =
  'cursor-not-allowed bg-muted/50 hover:border-border [&_b]:text-muted-foreground';
/** The mockup's `.tok`: a token in the rule box. */
export const TOK =
  'inline-flex h-7 max-w-full items-center gap-1 rounded-lg border bg-card px-2 text-[12.5px] text-foreground outline-none hover:border-foreground/25 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive';
const KW = 'w-11 shrink-0 font-mono text-[11px] font-semibold text-muted-foreground';
const ROW = 'flex flex-wrap items-center gap-2';
export const BOX =
  'overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]';
export const EM = 'block text-[11.5px] not-italic text-muted-foreground';

/** The id of a field's problem line, for the field's aria-describedby. */
export const errorId = (field: string) => `agent-form-error-${field}`;

/**
 * A problem under a field: read with the field (aria-describedby), not as
 * an alert of its own — the step's one alert says how many there are.
 */
export function FieldError({ field, children }: { field: string; children: ReactNode }) {
  return (
    <p id={errorId(field)} data-field-error={field} className="mt-1.5 text-xs text-destructive">
      {children}
    </p>
  );
}

const RADIO_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];

/**
 * A radio group's arrow keys (WAI-ARIA radio group): the next or previous
 * radio that isn't locked gets the focus and is chosen; Home and End the
 * first and last. Tab reaches the group once (`radioTab`).
 */
export function radioKeys(event: KeyboardEvent<HTMLElement>) {
  if (!RADIO_KEYS.includes(event.key)) return;
  const radios = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="radio"]:not([aria-disabled="true"])',
    ),
  ];
  if (radios.length === 0) return;
  event.preventDefault();
  const at = radios.indexOf(event.target as HTMLElement);
  const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const to =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? radios.length - 1
        : at < 0
          ? 0
          : (at + (back ? -1 : 1) + radios.length) % radios.length;
  radios[to].focus();
  if (radios[to].getAttribute('aria-checked') !== 'true') radios[to].click();
}

/** Which radio Tab reaches: the chosen one, or the first when none is. */
export const radioTab = (on: boolean, first: boolean, anyOn: boolean) =>
  on || (first && !anyOn) ? 0 : -1;

/** A section's title (mockup `.h2`), with its count and a button on the right. */
export function SectionTitle({
  title,
  count,
  first,
  children,
}: {
  title: string;
  count?: string;
  first?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn('mb-2.5 flex items-center gap-2', first ? 'mt-0' : 'mt-[22px]')}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {count && (
        <span className="rounded-full bg-muted px-[7px] text-[11.5px] font-medium text-foreground/70 tabular-nums">
          {count}
        </span>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** A switch (mockup `.sw`): 30×18, dark when on. */
export function FormSwitch({
  checked,
  label,
  action,
  onChange,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  label: string;
  action: string;
  onChange: (next: boolean) => void;
  /** It can't be changed now; its reason is the line `describedBy` names. */
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      data-action={action}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-[30px] shrink-0 rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
        checked ? 'bg-foreground' : 'bg-muted-foreground/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full bg-background transition-[left] duration-200 motion-reduce:transition-none',
          checked ? 'left-[14px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

/** A token that opens a small panel: the scope's lists. */
function TokenPanel({
  label,
  text,
  action,
  invalid,
  field,
  children,
}: {
  label: string;
  text: string;
  action: string;
  invalid?: boolean;
  /** Its problem line's field, read with it while invalid. */
  field?: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-action={action}
        aria-label={`${label}: ${text}`}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && field ? errorId(field) : undefined}
        className={TOK}
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5" aria-label={label}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Check({
  checked,
  label,
  action,
  onChange,
}: {
  checked: boolean;
  label: string;
  action: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted">
      <input
        type="checkbox"
        data-action={action}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 shrink-0 accent-foreground"
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

/** The trigger kinds a kept trigger can be (Manual is always there, as its own line). */
const KINDS = ['schedule', 'signal', 'kpi', 'watch_rule'] as const;

/** The control a trigger's problem is about, so it is marked and read with it. */
const PROBLEM_CONTROL: Record<string, 'date' | 'time' | 'category' | 'kpi' | 'threshold'> = {
  date_required: 'date',
  schedule_past: 'date',
  schedule_too_far: 'date',
  time_required: 'time',
  category_required: 'category',
  kpi_required: 'kpi',
  threshold: 'threshold',
  threshold_percent: 'threshold',
};
const KIND_CONTROL = { schedule: 'time', signal: 'category', kpi: 'kpi' } as const;

export function TriggerStep({
  state,
  update,
  setup,
  words,
  now,
  problems,
  shown,
  selected,
  onSelect,
  onKind,
  onAdd,
  onRemove,
  onTrigger,
}: {
  state: AgentFormState;
  update: (patch: Partial<AgentFormState>) => void;
  setup: AgentFormSetup;
  words: AgentWords;
  now: Date;
  problems: StepProblems;
  /** The step's problems are shown (Next was tried). */
  shown: boolean;
  /** The trigger the rule box edits, by key; null: none kept (Manual only). */
  selected: string | null;
  onSelect: (key: string) => void;
  /** The selected trigger becomes this kind (one is added when none is kept). */
  onKind: (kind: TriggerKind) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onTrigger: (key: string, patch: Partial<TriggerDraft>) => void;
}) {
  const t = useTranslations('chatAgents.form');
  const tAgents = useTranslations('chatAgents');
  const tErrors = useTranslations('chatAgents.form.errors');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tKpis = useTranslations('actionCenter.registry');
  const draft = state.triggers.find((d) => d.key === selected) ?? null;
  const full = state.triggers.length >= MAX_AGENT_TRIGGERS;
  // The selected trigger's problem: marked on its control and read with it.
  const draftProblem = draft && shown ? problems.triggers[draft.key] : undefined;
  const invalidOn = (control: 'date' | 'time' | 'category' | 'kpi' | 'threshold') => {
    if (!draft || !draftProblem || draft.kind === 'watch_rule') return {};
    const target = PROBLEM_CONTROL[draftProblem] ?? KIND_CONTROL[draft.kind];
    return target === control
      ? { 'aria-invalid': true, 'aria-describedby': errorId(`trigger-${draft.key}`) }
      : {};
  };
  const error = (code: string | undefined, field: string) =>
    shown && code ? (
      <FieldError field={field}>{tErrors(code, { plan: setup.fullAutoPlan })}</FieldError>
    ) : null;

  /**
   * A trigger's line: its next run, on the schedule's own clock and named
   * (a one-off on the viewer's), when it fires, or that it is off.
   */
  const detail = (d: TriggerDraft) => {
    if (!d.enabled) return tAgents('trigger.off');
    if (d.kind !== 'schedule') return tAgents(`trigger.firesWhen.${d.kind}`);
    const next = draftNextFire(d, now);
    // A kept one-off already fired; a new one isn't complete or is in the past.
    if (!next) {
      return d.raw !== null
        ? tAgents('trigger.onceDone')
        : tErrors(triggerError(d, now) ?? 'trigger_invalid');
    }
    if (d.repeat === 'once') return tAgents('line.nextRun', { when: words.when(next) });
    return `${tAgents('line.nextRun', { when: words.when(next, d.timezone) })} · ${tAgents(
      'trigger.timeZone',
      { zone: d.timezone },
    )}`;
  };

  const brandsText = state.allBrands
    ? t('scope.allBrands')
    : state.brandIds.length === 0
      ? t('scope.noBrand')
      : state.brandIds.length === 1
        ? (setup.brands.find((b) => b.id === state.brandIds[0])?.name ?? t('scope.noBrand'))
        : t('scope.brandCount', { count: state.brandIds.length });
  const enginesText =
    state.engines.length === 0
      ? t('scope.allEngines')
      : state.engines.length === 1
        ? engineName(state.engines[0])
        : t('scope.engineCount', { count: state.engines.length });
  const inScope = new Set(state.allBrands ? setup.brands.map((b) => b.id) : state.brandIds);
  const topics = setup.topics.filter((topic) => inScope.has(topic.brandId));
  const topicsText =
    state.topicIds.length === 0
      ? t('scope.anyTopic')
      : state.topicIds.length === 1
        ? (setup.topics.find((topic) => topic.id === state.topicIds[0])?.name ??
          t('scope.topicCount', { count: 1 }))
        : t('scope.topicCount', { count: state.topicIds.length });
  const tags = parseList(state.tagsText);
  const urls = parseList(state.urlsText);

  /** Brands chosen: topics of brands no longer in scope go. */
  const setBrands = (allBrands: boolean, brandIds: string[]) => {
    const keep = new Set(allBrands ? setup.brands.map((b) => b.id) : brandIds);
    update({
      allBrands,
      brandIds,
      topicIds: state.topicIds.filter((id) =>
        keep.has(setup.topics.find((topic) => topic.id === id)?.brandId ?? ''),
      ),
    });
  };
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);

  const repeats: ScheduleRepeat[] =
    draft?.kind === 'schedule' && draft.repeat === 'custom'
      ? [...SCHEDULE_REPEATS, 'custom']
      : [...SCHEDULE_REPEATS];

  return (
    <>
      <SectionTitle
        first
        title={t('trigger.list')}
        count={t('trigger.count', { count: state.triggers.length })}
      >
        <Button
          size="sm"
          variant="outline"
          data-action="agentNew.addTrigger"
          disabled={full}
          title={full ? t('trigger.max') : undefined}
          onClick={onAdd}
        >
          <Plus aria-hidden />
          {t('trigger.add')}
        </Button>
      </SectionTitle>

      <div data-slot="agent-form-triggers" className={BOX}>
        {/* Manual is always on (§E): Run now, and Run agent on an action. */}
        <div
          data-slot="agent-form-manual"
          className="grid grid-cols-[118px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-[9px] text-[13px] max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
        >
          <span className="text-xs text-muted-foreground max-[640px]:hidden">
            {t('trigger.options.manual')}
          </span>
          <div className="min-w-0">
            <b className="block truncate font-medium">{t('trigger.manualWhen')}</b>
            <em className={cn(EM, 'truncate text-xs')}>{t('trigger.notes.manual')}</em>
          </div>
          <span className="rounded-full border px-2 py-px text-[11px] text-muted-foreground">
            {t('trigger.alwaysOn')}
          </span>
        </div>
        {state.triggers.map((d) => {
          const input = triggerInputOf(d);
          const problem = shown ? problems.triggers[d.key] : undefined;
          return (
            <div
              key={d.key}
              data-slot="agent-form-trigger"
              data-kind={d.kind}
              className={cn(
                'grid grid-cols-[118px_minmax(0,1fr)_30px_28px] items-center gap-3 border-t px-3.5 py-[9px] text-[13px] max-[640px]:grid-cols-[minmax(0,1fr)_30px_28px]',
                d.key === selected && 'bg-muted/50',
                !d.enabled && 'text-muted-foreground',
              )}
            >
              <span className="text-xs text-muted-foreground max-[640px]:hidden">
                {tAgents(`trigger.types.${d.kind}`)}
              </span>
              <button
                type="button"
                data-action="agentNew.selectTrigger"
                aria-pressed={d.key === selected}
                title={t('trigger.select')}
                onClick={() => onSelect(d.key)}
                className="min-w-0 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <b className="block truncate font-medium">
                  {input ? words.trigger(input) : tAgents(`trigger.types.${d.kind}`)}
                </b>
                {problem ? (
                  <em
                    data-trigger-error={d.key}
                    className="block truncate text-xs text-destructive not-italic"
                  >
                    {tErrors(problem)}
                  </em>
                ) : (
                  <em className={cn(EM, 'truncate text-xs')}>{detail(d)}</em>
                )}
              </button>
              <FormSwitch
                checked={d.enabled}
                label={t('trigger.switch')}
                action="agentNew.toggleTrigger"
                onChange={(enabled) => onTrigger(d.key, { enabled })}
              />
              <button
                type="button"
                data-action="agentNew.removeTrigger"
                aria-label={t('trigger.remove')}
                title={t('trigger.remove')}
                onClick={() => onRemove(d.key)}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      {error(problems.fields.triggers, 'triggers')}

      <div
        role="radiogroup"
        aria-label={t('trigger.kindLabel')}
        onKeyDown={radioKeys}
        className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2"
      >
        {KINDS.map((kind, i) => {
          const on = draft?.kind === kind;
          // Watch rules are chosen on the rule (CHAT-22): a kept one stays, no new one here.
          const locked =
            (kind === 'watch_rule' && draft?.kind !== 'watch_rule') || (!draft && full);
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={locked || undefined}
              tabIndex={locked ? -1 : radioTab(on, i === 0, !!draft)}
              data-action="agentNew.trigger"
              data-trigger={kind}
              onClick={() => {
                if (!locked && !on) onKind(kind);
              }}
              className={cn(OPT, on && OPT_ON, locked && OPT_OFF)}
            >
              <b className="font-semibold">{t(`trigger.options.${kind}`)}</b>
              <em className={EM}>
                {kind === 'watch_rule' && locked
                  ? t('trigger.watchRuleNone')
                  : t(`trigger.notes.${kind}`)}
              </em>
            </button>
          );
        })}
      </div>

      <div
        data-slot="agent-form-rule"
        className="mt-3 grid gap-2 rounded-xl border bg-card p-3 text-[13px]"
      >
        <div className={ROW}>
          {!draft && (
            <>
              <span className={KW}>{t('trigger.kw.when')}</span>
              <span>{t('trigger.manualWhen')}</span>
            </>
          )}
          {draft?.kind === 'schedule' && (
            <>
              <span className={KW}>
                {draft.repeat === 'once' ? t('trigger.kw.when') : t('trigger.kw.every')}
              </span>
              <select
                aria-label={t('trigger.repeatLabel')}
                data-action="agentNew.repeat"
                value={draft.repeat}
                onChange={(event) => {
                  const repeat = event.target.value as ScheduleRepeat;
                  onTrigger(draft.key, {
                    repeat,
                    ...(repeat === 'once' && !draft.date
                      ? { date: dayIn(now.getTime() + 86_400_000, draft.timezone) }
                      : {}),
                  });
                }}
                className={TOK}
              >
                {repeats.map((repeat) => (
                  <option key={repeat} value={repeat}>
                    {t(`trigger.repeat.${repeat}`)}
                  </option>
                ))}
              </select>
              {draft.repeat === 'once' && (
                <>
                  <span>{t('trigger.on')}</span>
                  <input
                    type="date"
                    aria-label={t('trigger.dateLabel')}
                    data-action="agentNew.date"
                    {...invalidOn('date')}
                    value={draft.date}
                    onChange={(event) => onTrigger(draft.key, { date: event.target.value })}
                    className={TOK}
                  />
                </>
              )}
              <span>{t('trigger.at')}</span>
              <input
                type="time"
                aria-label={t('trigger.timeLabel')}
                data-action="agentNew.time"
                {...invalidOn('time')}
                value={draft.time}
                step={300}
                onChange={(event) => onTrigger(draft.key, { time: event.target.value })}
                className={TOK}
              />
              <span className="text-xs text-muted-foreground">
                {tAgents('trigger.timeZone', { zone: draft.timezone })}
              </span>
            </>
          )}
          {draft?.kind === 'signal' && (
            <>
              <span className={KW}>{t('trigger.kw.when')}</span>
              <select
                aria-label={t('trigger.categoryLabel')}
                data-action="agentNew.category"
                {...invalidOn('category')}
                value={draft.category}
                onChange={(event) => onTrigger(draft.key, { category: event.target.value })}
                className={TOK}
              >
                {!draft.category && <option value="">{t('trigger.categoryLabel')}</option>}
                {ACTION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {tCategories(category)}
                  </option>
                ))}
              </select>
              <span>{t('trigger.signalWhen')}</span>
            </>
          )}
          {draft?.kind === 'kpi' && (
            <>
              <span className={KW}>{t('trigger.kw.when')}</span>
              <select
                aria-label={t('trigger.kpiLabel')}
                data-action="agentNew.kpi"
                {...invalidOn('kpi')}
                value={draft.kpi}
                onChange={(event) => onTrigger(draft.key, { kpi: event.target.value })}
                className={TOK}
              >
                {!draft.kpi && <option value="">{t('trigger.kpiLabel')}</option>}
                {KPI_KEYS.map((kpi) => (
                  <option key={kpi} value={kpi}>
                    {tKpis(`${kpi}.name`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('trigger.directionLabel')}
                data-action="agentNew.direction"
                value={draft.direction}
                onChange={(event) =>
                  onTrigger(draft.key, {
                    direction: event.target.value as 'up' | 'down' | 'any',
                  })
                }
                className={TOK}
              >
                {(['down', 'up', 'any'] as const).map((direction) => (
                  <option key={direction} value={direction}>
                    {t(`trigger.direction.${direction}`)}
                  </option>
                ))}
              </select>
              <span>{t('trigger.by')}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={t('trigger.thresholdLabel')}
                data-action="agentNew.threshold"
                {...invalidOn('threshold')}
                value={draft.threshold}
                onChange={(event) => onTrigger(draft.key, { threshold: event.target.value })}
                className={cn(TOK, 'w-20 tabular-nums')}
              />
              <select
                aria-label={t('trigger.unitLabel')}
                data-action="agentNew.unit"
                value={draft.unit}
                onChange={(event) =>
                  onTrigger(draft.key, { unit: event.target.value as 'percent' | 'absolute' })
                }
                className={TOK}
              >
                {(['percent', 'absolute'] as const).map((unit) => (
                  <option key={unit} value={unit}>
                    {t(`trigger.unit.${unit}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('trigger.periodLabel')}
                data-action="agentNew.period"
                value={draft.period}
                onChange={(event) =>
                  onTrigger(draft.key, { period: event.target.value as 'day' | 'week' | 'month' })
                }
                className={TOK}
              >
                {(['day', 'week', 'month'] as const).map((period) => (
                  <option key={period} value={period}>
                    {t(`trigger.period.${period}`)}
                  </option>
                ))}
              </select>
            </>
          )}
          {draft?.kind === 'watch_rule' && (
            <>
              <span className={KW}>{t('trigger.kw.when')}</span>
              <span>{t('trigger.watchRuleWhen')}</span>
            </>
          )}
        </div>
        {draft && shown && problems.triggers[draft.key] && (
          <FieldError field={`trigger-${draft.key}`}>
            {tErrors(problems.triggers[draft.key])}
          </FieldError>
        )}

        <div className={ROW}>
          <span className={KW}>{t('trigger.kw.for')}</span>
          <TokenPanel
            label={t('scope.brands')}
            text={brandsText}
            action="agentNew.brands"
            invalid={shown && !!problems.fields.brands}
            field="brands"
          >
            <Check
              checked={state.allBrands}
              label={t('scope.allBrands')}
              action="agentNew.allBrands"
              onChange={(on) => setBrands(on, on ? [] : state.brandIds)}
            />
            {setup.brands.map((brand) => (
              <Check
                key={brand.id}
                checked={!state.allBrands && state.brandIds.includes(brand.id)}
                label={brand.name}
                action="agentNew.brand"
                onChange={(on) =>
                  setBrands(false, toggle(state.allBrands ? [] : state.brandIds, brand.id, on))
                }
              />
            ))}
          </TokenPanel>
          <TokenPanel
            label={t('scope.engines')}
            text={enginesText}
            action="agentNew.engines"
            invalid={shown && !!problems.fields.engines}
            field="engines"
          >
            <Check
              checked={state.engines.length === 0}
              label={t('scope.allEngines')}
              action="agentNew.allEngines"
              onChange={(on) => on && update({ engines: [] })}
            />
            {setup.engines.map((id) => (
              <Check
                key={id}
                checked={state.engines.includes(id)}
                label={engineName(id)}
                action="agentNew.engine"
                onChange={(on) => update({ engines: toggle(state.engines, id, on) })}
              />
            ))}
          </TokenPanel>
          {(topics.length > 0 || state.topicIds.length > 0) && (
            <TokenPanel label={t('scope.topics')} text={topicsText} action="agentNew.topics">
              {topics.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('scope.noTopics')}</p>
              )}
              {topics.map((topic) => (
                <Check
                  key={topic.id}
                  checked={state.topicIds.includes(topic.id)}
                  label={topic.name}
                  action="agentNew.topic"
                  onChange={(on) => update({ topicIds: toggle(state.topicIds, topic.id, on) })}
                />
              ))}
            </TokenPanel>
          )}
          <TokenPanel
            label={t('scope.tags')}
            text={
              tags.length === 0 ? t('scope.anyTag') : t('scope.tagCount', { count: tags.length })
            }
            action="agentNew.tags"
            invalid={shown && !!problems.fields.tags}
            field="tags"
          >
            <Textarea
              aria-label={t('scope.tags')}
              data-action="agentNew.tagsText"
              rows={4}
              value={state.tagsText}
              onChange={(event) => update({ tagsText: event.target.value })}
              className="text-[13px]"
            />
            <p className="px-1 pt-1 text-[11.5px] text-muted-foreground">{t('scope.tagsNote')}</p>
          </TokenPanel>
          <TokenPanel
            label={t('scope.urls')}
            text={
              urls.length === 0 ? t('scope.anyUrl') : t('scope.urlCount', { count: urls.length })
            }
            action="agentNew.urls"
            invalid={shown && !!problems.fields.urls}
            field="urls"
          >
            <Textarea
              aria-label={t('scope.urls')}
              data-action="agentNew.urlsText"
              rows={4}
              value={state.urlsText}
              onChange={(event) => update({ urlsText: event.target.value })}
              className="text-[13px]"
            />
            <p className="px-1 pt-1 text-[11.5px] text-muted-foreground">{t('scope.urlsNote')}</p>
          </TokenPanel>
        </div>
        {(['brands', 'engines', 'tags', 'urls'] as const).map((field) => (
          <span key={field} className="contents">
            {error(problems.fields[field], field)}
          </span>
        ))}

        <div className={ROW}>
          <span className={KW}>{t('trigger.kw.then')}</span>
          <span className={cn(TOK, 'bg-muted hover:border-border')}>{t('trigger.runAgent')}</span>
        </div>
      </div>
    </>
  );
}
