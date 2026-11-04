'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronDown, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isPageType, type PageType } from '@/lib/content/drafts';
import { SITE_PAGE_TYPES, type SiteType } from '@/lib/content/pageTypes';
import {
  MAX_TEXT_RULE_LENGTH,
  NO_HELD,
  NO_REACH,
  heldMessage,
  RULE_GROUPS,
  notForAgentMessage,
  openRulesForAgent,
  lengthBand,
  lengthOutOfReach,
  rewriteAdvice,
  splitRules,
  type ActiveRule,
  type RewriteReach,
  type RuleStatus,
  type TextRule,
} from '@/lib/content/rules';
import { listed } from '@/lib/content/shoppingCheck';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/useUserRole';
import { RunCard } from './_RunCard';
import type { DraftRulesState } from './_useDraftRules';
import { BrandRulesBox } from './_BrandRulesBox';

/** Rules with an explanation on hover (spec §10). */
const HINTED = new Set([
  'length',
  'oneH1',
  'summary',
  'fanoutH2',
  'internalLinks',
  'outboundLinks',
  'aiTraces',
  'whoFor',
  'first40Words',
  'feedMatch',
  'shopCategoryLink',
  'shopProductLinks',
  'shopLinksLive',
]);

/**
 * The Rules tab (Content Editor CE-009, spec §10): the rule set for the
 * page's type — its own rules, then length and structure, fan-outs and
 * keywords, links and sources, style — each with an on/off switch, a value
 * the person can change for this draft, and its status as the page reads
 * now. "N of M rules met" counts the rules on that the page can say; the
 * header's chip shows the same. Rules in the person's own words follow
 * ("Your text rules"); Save as my rules keeps the set for the workspace's
 * drafts of the type, and Reset goes back to GetCito's default.
 */
/** Fix open rules with the agent (CE-018), as the editor runs it. */
export interface AgentFix {
  /** Runs the agent on the open rules, or only on the ones named. */
  run: (only?: string[]) => void;
  running: boolean;
  /** Why it can't run now (suggestions still open), or null. */
  blocked: string | null;
  /** Open rules no run can close here: held by what the page keeps (openRulesForAgent). */
  held?: ReadonlySet<string>;
  /** Open rules a Fix was sent and couldn't close (triedRules.ts): the person's to decide. */
  tried?: ReadonlySet<string>;
}

/** Rewrite the whole page to these rules, as the editor runs it: one suggestion. */
export interface PageRewrite {
  /** `citedToo`: the passages AI answers quote are rewritten too. */
  run: (options?: { citedToo?: boolean }) => void;
  running: boolean;
  /** Why it can't run now (suggestions still open), or null. */
  blocked: string | null;
  /** What it keeps, the least it comes to and what the last one came to: a Length under them is out of reach. */
  reach?: RewriteReach;
  /** The passages AI answers quote that it keeps now (locked, not unlocked): how many, their characters. */
  cited?: { count: number; chars: number };
}

/** Run Agent's two ways: the open rules fixed a few passages at a time, or the whole page. */
type RunMode = 'fix' | 'rewrite';

/**
 * Run Agent ▾ (v1.1, CE-029): one control for both rule actions. The main
 * part runs the choice, Fix open rules unless the person picked Rewrite the
 * whole page in ▾, which then labels it "Rewrite page"; once a rewrite
 * starts, it is back on the safe default. Each choice says what it does and
 * its AI usage, Less or More, until a real estimate exists.
 */
function RunAgentButton({
  mode,
  onMode,
  run,
  running,
  disabled,
  split,
  anyRunning,
  fixable,
  setName,
  recommended,
}: {
  /** The choice the main part runs. */
  mode: RunMode;
  onMode: (mode: RunMode) => void;
  run: () => void;
  running: boolean;
  disabled: boolean;
  /** Both ways are offered: a page ready or published has no rewrite. */
  split: boolean;
  /** Either way is running: the choice waits for it. */
  anyRunning: boolean;
  /** The open rules the agent can fix. */
  fixable: number;
  /** The rule set's name, as the menu says what a rewrite follows. */
  setName: string;
  /** Rewrite when small edits can't get there (rewriteAdvice), else Fix; none when Fix is off. */
  recommended: RunMode | null;
}) {
  const t = useTranslations('contentEditor.editor.rules.run');
  const main = (
    <Button
      size="sm"
      className={cn(split && 'rounded-r-none')}
      disabled={running || disabled}
      onClick={() => {
        run();
        if (mode === 'rewrite') onMode('fix');
      }}
    >
      {/* The agent card says it's working, alone (editor UX review 2026-11-03). */}
      {mode === 'rewrite' ? t('rewriteLabel') : t('label')}
    </Button>
  );
  if (!split) return main;
  const choices: { value: RunMode; title: string; detail: string; usage: string }[] = [
    {
      value: 'fix',
      title: t('fix.title'),
      detail: t('fix.detail', { count: fixable }),
      usage: t('fix.usage'),
    },
    {
      value: 'rewrite',
      title: t('rewrite.title'),
      detail: t('rewrite.detail', { set: setName }),
      usage: t('rewrite.usage'),
    },
  ];
  return (
    <span className="inline-flex shrink-0">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={anyRunning}
          render={
            <Button
              size="sm"
              aria-label={t('more')}
              className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
            />
          }
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup value={mode} onValueChange={(value) => onMode(value as RunMode)}>
            {choices.map((choice) => (
              <DropdownMenuRadioItem
                key={choice.value}
                value={choice.value}
                closeOnClick
                disabled={choice.value === 'fix' && fixable === 0}
                className="items-start py-1.5"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[13px] font-medium">{choice.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {recommended === choice.value
                      ? t('recommendedDetail', { detail: choice.detail })
                      : choice.detail}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80">{choice.usage}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

export function RulesTab({
  state,
  siteType,
  draftPageType,
  agentFix,
  pageRewrite,
  dataLine,
  onOpenSources,
  brandRules,
}: {
  state: DraftRulesState;
  siteType: SiteType;
  draftPageType: PageType | null;
  agentFix?: AgentFix;
  pageRewrite?: PageRewrite;
  /** "Uses your data", under Run Agent's card (v1.1 CE-032). */
  dataLine?: React.ReactNode;
  /**
   * Opens the Sources tab, where a draft with no prompts (so no fan-outs)
   * gets them; none while the sources are read, or when the draft has prompts.
   */
  onOpenSources?: () => void;
  /** The brand's rules from Settings › Content (00450), shown read-only above the page's own. */
  brandRules?: { rules: string[]; brandName: string };
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const tSuggestions = useTranslations('contentEditor.editor.suggestions');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const format = useFormatter();
  // The workspace's sets are saved by admins and managers, as its other settings are.
  const { canManage } = useUserRole();
  const types = [...SITE_PAGE_TYPES[siteType]];
  for (const type of [draftPageType, state.setType, ...state.mineTypes]) {
    if (type && !types.includes(type)) types.push(type);
  }
  const items = [
    ...types.map((type) => ({
      value: `default:${type}`,
      label: t('setName', { type: tTypes(type) }),
    })),
    ...state.mineTypes.map((type) => ({
      value: `mine:${type}`,
      label: t('mineName', { type: tTypes(type) }),
    })),
  ];

  // Rewrite the page whole when small edits can't get there.
  const held = agentFix?.held ?? NO_HELD;
  const tried = agentFix?.tried ?? NO_HELD;
  const advice = pageRewrite ? rewriteAdvice(state.rules, pageRewrite.reach, held) : null;
  // A Length the rewrite can't reach: said with a Length it can, never recommended.
  const outOfReach = pageRewrite
    ? lengthOutOfReach(state.rules, pageRewrite.reach ?? NO_REACH)
    : null;
  // Rewrite the cited passages too: offered when they are what holds the
  // Length out of reach, the rest fitting without them.
  const cited = pageRewrite?.cited;
  const citedHold =
    !!outOfReach &&
    !!cited &&
    cited.count > 0 &&
    (pageRewrite?.reach ?? NO_REACH).floor - cited.chars <= lengthBand(outOfReach.target).max;
  // The rules the page doesn't meet now, in the tab's order, and those the agent fixes.
  const open = state.rules.filter(({ rule, status }) => rule.on && status.state === 'bad');
  const { forAgent, notForAgent, held: heldOpen } = openRulesForAgent(state.rules, undefined, held);
  const fixable = forAgent.length;
  // Run Agent's choice: the safe default, or the whole page (▾) while it is offered.
  const [picked, setPicked] = useState<RunMode>('fix');
  const mode: RunMode = picked === 'rewrite' && pageRewrite ? 'rewrite' : 'fix';
  const runner = mode === 'rewrite' ? pageRewrite : agentFix;
  // Why Run Agent can't run its choice now, said under the card.
  const blocked =
    runner?.blocked ??
    (mode === 'fix' && fixable === 0
      ? notForAgent.length === 0 && heldOpen.length > 0
        ? t(heldMessage(heldOpen))
        : tSuggestions(notForAgentMessage(notForAgent))
      : null);

  // A draft on My rules for a type the workspace has none for (its type
  // changed, or My rules couldn't be read) shows GetCito's set for it.
  const source =
    state.source === 'mine' && state.setType && state.mineTypes.includes(state.setType)
      ? 'mine'
      : 'default';
  const setName =
    items.find((item) => item.value === `${source}:${state.setType}`)?.label ?? t('pickSet');

  return (
    // Nothing changes before My rules are read: a change would leave them out.
    <fieldset
      disabled={!state.ready}
      aria-busy={!state.ready}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-sm"
    >
      {/* What the agent can do about the rules, first (v1.1, CE-028/029): one
          Run Agent, fixing the open rules a few passages at a time, or (▾)
          rewriting the whole page as one change to compare. */}
      {(agentFix || pageRewrite) && (
        <RunCard
          title={open.length > 0 ? t('run.notMet', { count: open.length }) : t('run.allMet')}
          detail={
            open.length > 0
              ? t('run.names', {
                  names: format.list(
                    open.slice(0, 3).map(({ rule }) => t(`names.${rule.key}`)),
                    { type: 'unit' },
                  ),
                  more: open.length > 3 ? 'yes' : 'no',
                })
              : undefined
          }
          action={
            open.length > 0 &&
            runner && (
              <RunAgentButton
                mode={mode}
                onMode={setPicked}
                run={() => runner.run()}
                running={runner.running}
                disabled={blocked !== null}
                split={!!agentFix && !!pageRewrite}
                anyRunning={!!agentFix?.running || !!pageRewrite?.running}
                fixable={fixable}
                setName={setName}
                // Nothing is recommended that is turned off (Fix with only One H1 open).
                recommended={advice ? 'rewrite' : fixable > 0 ? 'fix' : null}
              />
            )
          }
          info={t.rich(pageRewrite ? 'run.info' : 'run.infoFix', {
            b: (chunks) => <b>{chunks}</b>,
          })}
          data={dataLine}
          blocked={open.length > 0 ? blocked : null}
        >
          {advice && (
            <p className="flex gap-1.5 text-xs" role="note">
              <Sparkles aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <span>
                {advice.reason === 'length'
                  ? t('rewriteAdvice.length', {
                      count: advice.count,
                      target: advice.target,
                      percent: advice.percent,
                    })
                  : t('rewriteAdvice.open', { count: advice.count })}
              </span>
            </p>
          )}
          {outOfReach && (
            <div className="flex gap-1.5 text-xs" role="note">
              <Info aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-1.5">
                <p>
                  {t(
                    outOfReach.why === 'reached'
                      ? 'lengthOutOfReachRun'
                      : outOfReach.kept > 0
                        ? 'lengthOutOfReach'
                        : 'lengthOutOfReachHeadings',
                    {
                      count: outOfReach.count,
                      target: outOfReach.target,
                      kept: outOfReach.kept,
                      least: outOfReach.least,
                      suggested: outOfReach.suggested,
                    },
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => state.change('length', { value: String(outOfReach.suggested) })}
                  >
                    {t('raiseLength', { suggested: outOfReach.suggested })}
                  </Button>
                  {/* The quoted passages kept are what holds it: rewritten too, compared first. */}
                  {citedHold && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={pageRewrite.running || pageRewrite.blocked !== null}
                      onClick={() => pageRewrite.run({ citedToo: true })}
                    >
                      {t('rewriteCitedToo')}
                    </Button>
                  )}
                </div>
                {citedHold && <p className="text-muted-foreground">{t('rewriteCitedTooHint')}</p>}
              </div>
            </div>
          )}
        </RunCard>
      )}

      {brandRules && <BrandRulesBox rules={brandRules.rules} brandName={brandRules.brandName} />}

      <div className="space-y-1.5">
        <span className="text-xs text-muted-foreground">{t('set')}</span>
        <Select
          items={items}
          value={state.setType ? `${source}:${state.setType}` : ''}
          onValueChange={(value) => {
            const [source, type] = String(value ?? '').split(':');
            if (!isPageType(type) || (source !== 'default' && source !== 'mine')) return;
            state.pickSet(type, source);
          }}
        >
          <SelectTrigger aria-label={t('set')} className="w-full">
            <SelectValue placeholder={t('pickSet')} />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground" role="status">
          {state.settled === false
            ? t('metReading')
            : t('met', { met: state.met, total: state.total })}
        </p>
      </div>

      {RULE_GROUPS.map((group) => {
        const rows = state.rules.filter((r) => r.rule.group === group);
        if (!rows.length) return null;
        return (
          <section key={group} className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              {group === 'type' && state.setType
                ? t('typeGroup', { type: tTypes(state.setType) })
                : t(`groups.${group}`)}
            </h4>
            <ul className="divide-y rounded-lg border">
              {rows.map(({ rule, status }) => (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  status={status}
                  yours={tried.has(rule.key) || held.has(rule.key)}
                  onChange={(change) => state.change(rule.key, change)}
                  agentFix={rule.key === 'aiTraces' ? agentFix : undefined}
                  onOpenSources={onOpenSources}
                  merchantCenter={state.merchantCenter ?? false}
                  note={
                    rule.key === 'length' && state.lengthConflict
                      ? t('lengthConflict', state.lengthConflict)
                      : // Said where the Length is set, not only in Run Agent's card
                        // (editor test 2026-11-03: a Length set lower seemed ignored).
                        rule.key === 'length' && outOfReach
                        ? t('lengthOutOfReachNote', { least: outOfReach.least })
                        : rule.key === 'sentence' && held.has('sentence') && status.state === 'bad'
                          ? t('heldSentence')
                          : tried.has(rule.key) && status.state === 'bad'
                            ? t('triedNote')
                            : rule.key === 'shopLinksLive'
                              ? shoppingNote(t, status)
                              : undefined
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}

      {state.textRules.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t('text.title')}</h4>
          <ul className="divide-y rounded-lg border">
            {state.textRules.map(({ rule, check }) => (
              <TextRuleRow
                key={rule.id}
                rule={rule}
                check={check}
                onChange={(change) => state.changeTextRule(rule.id, change)}
              />
            ))}
          </ul>
        </section>
      )}

      <AddTextRules onAdd={state.addTextRules} />

      <div className="flex flex-wrap gap-2">
        {canManage && (
          <Button size="sm" disabled={!state.setType} onClick={state.saveAsMine}>
            {t('saveMine')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={state.reset}>
          {t('reset')}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">{t('note')}</p>
    </fieldset>
  );
}

/** A rule in the person's own words: edited in place, turned off, removed when emptied. */
function TextRuleRow({
  rule,
  check,
  onChange,
}: {
  rule: TextRule;
  check: 'numberCheck' | 'aiCheck';
  onChange: (change: { text?: string; on?: boolean }) => void;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const [text, setText] = useState(rule.text);
  const [editing, setEditing] = useState(false);
  const commit = () => {
    setEditing(false);
    if (text.trim() !== rule.text) onChange({ text });
  };
  return (
    <li className={cn('flex items-center gap-2 px-3 py-2', !rule.on && 'opacity-60')}>
      <Switch
        on={rule.on}
        label={t('toggle', { name: rule.text })}
        onToggle={() => onChange({ on: !rule.on })}
      />
      <input
        value={editing ? text : rule.text}
        title={rule.text}
        aria-label={t('text.edit')}
        maxLength={MAX_TEXT_RULE_LENGTH}
        onFocus={() => {
          setText(rule.text);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(rule.text);
            setEditing(false);
          }
        }}
        className="h-6 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-xs outline-none hover:border-border focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <span
        className="w-20 shrink-0 text-right text-[11px] text-muted-foreground"
        title={t(`text.${check}Hint`)}
      >
        {rule.on ? t(`status.${check}`) : t('status.off')}
      </span>
    </li>
  );
}

/**
 * The linked products that no longer sell, by name and why, the first few
 * (No sold-out or refused product linked, shopping path); none while it's met.
 */
function shoppingNote(
  t: (key: string, values?: Record<string, string | number>) => string,
  status: RuleStatus,
): string | undefined {
  if (status.state !== 'bad' || status.code !== 'found' || !status.items?.length) return undefined;
  const { shown, more } = listed(status.items);
  return t('shopLinksLiveNote', {
    list: shown.map((item) => t('shopItem', { title: item.title, state: item.state })).join(', '),
    more,
  });
}

/** Write a rule, or paste many: each line becomes a rule (bullets and numbering taken off). */
function AddTextRules({ onAdd }: { onAdd: (lines: string[]) => void }) {
  const t = useTranslations('contentEditor.editor.rules.text');
  const [text, setText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const lines = splitRules(text);
  const pastedLines = splitRules(pasted);

  return (
    <div className="space-y-1.5 rounded-lg border p-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('placeholder')}
        aria-label={t('write')}
        rows={2}
        className="min-h-0 resize-none border-0 p-1 text-xs shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && lines.length) {
            e.preventDefault();
            onAdd(lines);
            setText('');
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t('help')}</span>
        <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
          {t('pasteMany')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!lines.length}
          onClick={() => {
            onAdd(lines);
            setText('');
          }}
        >
          {t('add')}
        </Button>
      </div>
      <Dialog open={pasting} onOpenChange={setPasting}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pasteTitle')}</DialogTitle>
            <DialogDescription>{t('pasteDescription')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label={t('pasteTitle')}
            rows={8}
            className="text-xs"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasting(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!pastedLines.length}
              onClick={() => {
                onAdd(pastedLines);
                setPasted('');
                setPasting(false);
              }}
            >
              {t('addMany', { count: pastedLines.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RuleRow({
  rule,
  status,
  yours = false,
  onChange,
  agentFix,
  onOpenSources,
  merchantCenter,
  note,
}: {
  rule: ActiveRule;
  status: RuleStatus;
  /**
   * Open, and the person's to decide: the agent tried it and couldn't close
   * it, or no run can (held). Amber, not red (editor test 2026-11-03).
   */
  yours?: boolean;
  onChange: (change: { on?: boolean; value?: string }) => void;
  /** "Remove AI traces" offers Fix: the agent rewrites only those phrases. */
  agentFix?: AgentFix;
  onOpenSources?: () => void;
  /** The brand has a Merchant Center account: the Shopping hints say it's checked. */
  merchantCenter: boolean;
  /** A warning under the rule: Length, when the other rules can't fit in it. */
  note?: string;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const name = t(`names.${rule.key}`);
  return (
    <li className={cn('px-3 py-2', !rule.on && 'opacity-60')}>
      <div className="flex items-center gap-2">
        {rule.fixed ? (
          // Always on: the editor keeps it, so it has no switch.
          <span aria-hidden="true" className="w-7 shrink-0" />
        ) : (
          <Switch
            on={rule.on}
            label={t('toggle', { name })}
            onToggle={() => onChange({ on: !rule.on })}
          />
        )}
        <span
          className="min-w-0 flex-1 text-xs"
          title={
            HINTED.has(rule.key)
              ? t(`hints.${rule.key}`, { merchantCenter: merchantCenter ? 'yes' : 'no' })
              : undefined
          }
        >
          {name}
        </span>
        <StatusBadge on={rule.on} status={status} yours={yours} onOpenSources={onOpenSources} />
        {agentFix && rule.on && status.state === 'bad' && (
          <button
            type="button"
            disabled={agentFix.running || agentFix.blocked !== null}
            title={agentFix.blocked ?? t('fixTraceHint')}
            onClick={() => agentFix.run([rule.key])}
            className="shrink-0 text-[11px] font-medium underline underline-offset-2 hover:no-underline disabled:opacity-50"
          >
            {t('fixTrace')}
          </button>
        )}
      </div>
      {rule.kind !== 'switch' && (
        <div className="mt-1 flex items-center gap-1 pl-9">
          <RuleValue rule={rule} name={name} onCommit={(value) => onChange({ value })} />
        </div>
      )}
      {note && rule.on && (
        <p className="mt-1 pl-9 text-[11px] text-amber-700 dark:text-amber-400">{note}</p>
      )}
    </li>
  );
}

/** A rule's value: changed for this draft when the field is left or Enter is pressed. */
function RuleValue({
  rule,
  name,
  onCommit,
}: {
  rule: ActiveRule;
  name: string;
  onCommit: (value: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.rules');
  const [text, setText] = useState(rule.current);
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : rule.current;

  const commit = () => {
    setEditing(false);
    const value = text.trim();
    if (value === rule.current) return;
    if (rule.kind === 'number' && !/^\d{1,6}$/.test(value)) return;
    onCommit(value);
  };

  const wide = rule.kind !== 'number';
  return (
    <span className={cn('flex items-center gap-1', wide ? 'min-w-0 flex-1' : 'shrink-0')}>
      <input
        value={shown}
        inputMode={rule.kind === 'number' ? 'numeric' : undefined}
        aria-label={t('value', { name })}
        placeholder={rule.key === 'whoFor' ? t('whoForPlaceholder') : undefined}
        maxLength={500}
        onFocus={() => {
          setText(rule.current);
          setEditing(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(rule.current);
            setEditing(false);
          }
        }}
        className={cn(
          'h-6 rounded-md border bg-background px-1.5 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          wide ? 'min-w-0 flex-1' : 'w-14 text-right',
          rule.changed && 'border-primary/50',
        )}
      />
      {rule.unit && (
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">
          {t(`units.${rule.unit}`)}
        </span>
      )}
    </span>
  );
}

/** How a rule reads now, as its badge says it ("✓", "3 found", "Missing"). */
export function ruleStatusText(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'ok') return '✓';
  if (status.code === 'partOf') return t('partOf', { count: status.count, of: status.of });
  if (status.code === 'current') return formatNumber(status.count);
  if ('count' in status) return t(status.code, { count: status.count });
  return t(status.code);
}

/**
 * The same in full, for the badge's hover and what the agent is told: a
 * length out of its band with the band ("15,921 characters, over 2,400–3,600").
 */
export function ruleStatusDetail(
  t: (key: string, values?: Record<string, number>) => string,
  status: RuleStatus,
): string {
  if (status.state === 'bad' && (status.code === 'short' || status.code === 'long')) {
    return t(`${status.code}Detail`, { count: status.count, min: status.min, max: status.max });
  }
  return ruleStatusText(t, status);
}

function StatusBadge({
  on,
  status,
  yours = false,
  onOpenSources,
}: {
  on: boolean;
  status: RuleStatus;
  /** Open and the person's to decide: amber, not red as the agent's still to fix. */
  yours?: boolean;
  onOpenSources?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.rules.status');
  if (on && onOpenSources && status.state === 'info' && status.code === 'noFanouts') {
    // No fan-outs means no prompts yet: where to add them.
    return (
      <button
        type="button"
        title={t('noFanoutsHint')}
        onClick={onOpenSources}
        className="w-20 shrink-0 truncate text-right text-[11px] font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {t('addPrompts')}
      </button>
    );
  }
  if (!on) {
    return (
      <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">{t('off')}</span>
    );
  }
  const text = ruleStatusText(t, status);
  return (
    <span
      title={ruleStatusDetail(t, status)}
      className={cn(
        'w-20 shrink-0 truncate text-right text-[11px] font-medium',
        status.state === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        // Red only for what blocks (editor UX review 2026-11-03): an open rule
        // is amber; one the agent tried, or no run can close, a chip with its note.
        status.state === 'bad' &&
          (yours
            ? 'rounded-md bg-amber-50 px-1 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            : 'text-amber-600 dark:text-amber-400'),
        status.state === 'info' && 'font-normal text-muted-foreground',
      )}
    >
      {text}
    </span>
  );
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors',
        on ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
          on ? 'left-3.5' : 'left-0.5',
        )}
      />
    </button>
  );
}
