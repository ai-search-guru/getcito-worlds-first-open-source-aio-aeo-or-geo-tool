'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { rulesForBrief, useRuleDescriber } from '@/lib/content/agentWrite';
import { isPageType, type ContentDraft } from '@/lib/content/drafts';
import type { SiteType } from '@/lib/content/pageTypes';
import { inputsGiven } from '@/lib/content/draftInputs';
import { shoppingPathFits } from '@/lib/content/shoppingPath';
import { buildSourceGroups, includedCounts, type DraftSourceKind } from '@/lib/content/sources';
import { formatNumber } from '@/lib/format';
import { BAND_CLASSES, qualityBand, qualityPhase } from '@/lib/content/quality';
import type { ClaimMark } from '@/lib/content/qualityChecks';
import { cn } from '@/lib/utils';
import { ShoppingPathSection } from './_ShoppingPath';
import { BriefTab, type AgentRewrite } from './_BriefTab';
import { DataNote, UsesYourData } from './_DataNote';
import { ImpactTab } from './_ImpactTab';
import { QualityTab, type HandOff, type QualityFocus, type QualityRead } from './_QualityTab';
import { RulesTab, type AgentFix, type PageRewrite } from './_RulesTab';
import { SourcesTab } from './_SourcesTab';
import { useBriefRebuild, type PageNow } from './_useBriefRebuild';
import type { DraftInputsRead } from './_useDraftInputs';
import type { DraftReads } from './_useDraftReads';
import type { DraftRulesState } from './_useDraftRules';
import { YourInput, type InputPrompt } from './_YourInput';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/** Remembers whether the panel is open, across drafts and visits. */
const PANEL_OPEN_KEY = 'aeo:content-editor-panel';
/** Wide enough for the page and the panel side by side: the panel starts open from here. */
const PANEL_OPEN_FROM = 1280;

/**
 * Whether the side panel is open: as the person last left it, else open on a
 * wide window. The editor renders on the client only (after its draft is
 * read), so the first state can read the window.
 */
export function useSidePanelOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(PANEL_OPEN_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      // Storage unavailable (private mode): fall back to the window's width.
    }
    return window.innerWidth >= PANEL_OPEN_FROM;
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(PANEL_OPEN_KEY, next ? '1' : '0');
    } catch {
      // The choice just won't persist.
    }
  };
  return [open, toggle];
}

// Instructions first (Content Editor v1.1, CE-028): Brief and Rules, what
// the agent follows, in one tab, which the panel opens on (on Rules).
const PANEL_TABS = ['instructions', 'sources', 'impact'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
/**
 * Instructions' segments: what to write (Brief), how to write it (Rules), and
 * how well it reads (Quality, Quality spec §3, once its first phase is live).
 */
const SEGMENTS = ['brief', 'rules', 'quality'] as const;
export type InstructionSegment = (typeof SEGMENTS)[number];
/** What the panel can be asked to open: a tab, or one of Instructions' segments. */
export type PanelTarget = PanelTab | InstructionSegment;
const isSegment = (target: PanelTarget): target is InstructionSegment =>
  (SEGMENTS as readonly string[]).includes(target);

/**
 * The panel's tabs while it is closed, down the editor's right edge, so the
 * panel is never out of sight (it starts closed on a narrow window). A tab
 * opens the panel on it.
 */
export function EditorPanelRail({ onOpen }: { onOpen: (tab: PanelTab) => void }) {
  const t = useTranslations('contentEditor.editor.panel');
  return (
    <nav
      aria-label={t('label')}
      className="flex w-9 shrink-0 flex-col items-center gap-1 border-l bg-card py-2"
    >
      {PANEL_TABS.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onOpen(value)}
          title={t('openTab', { tab: t(`tabs.${value}`) })}
          className="rounded-md px-1.5 py-2.5 text-xs font-medium text-muted-foreground transition-colors [writing-mode:vertical-rl] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t(`tabs.${value}`)}
        </button>
      ))}
    </nav>
  );
}

/**
 * The editor's right panel (Content Editor spec v2 §6), 400px beside the page.
 * Its tabs are Instructions · Sources · Live page (v1.1, CE-028): Instructions
 * holds what the agent follows, the Brief (CE-007) and the Rules (CE-009),
 * under a Brief | Rules control, with the rules still open on both. The panel
 * opens on Instructions, on Rules; each other tab or segment mounts (and
 * reads) when first opened, and stays mounted, so switching back keeps it as
 * it was. The brief and the sources are the editor's one read
 * (useDraftReads), which the rules check against too: Sources' "Rebuild with
 * selection" and Impact's "Use lost prompts" rebuild the brief, and open it.
 */
export function EditorSidePanel({
  draft,
  liveUrl = null,
  published = false,
  siteType,
  title,
  bodyHtml,
  pageType,
  rules,
  brandRules,
  reads,
  tabRequest,
  agentFix,
  pageRewrite,
  agentRewrite,
  lastSuggestionAt,
  onSourceShown,
  onBuildStarted,
  onBriefRebuilding,
  briefBlocked = null,
  quality = null,
  qualityScore = null,
  onShowInPage,
  onShowPlaceholder,
  onPickAuthor,
  yourInput = null,
  onAddInput,
  onConfirmAuthor,
  onKeepSource,
  onAddSource,
  onRemoveClaim,
  onConfirmImages,
  onAddImage,
  onPickReviewer,
  onAddCheckDate,
  onConfirmCase,
  onConfirmIntro,
  onChangeType,
  handOff = null,
  auditEstimate = null,
  onShoppingPathChange,
}: {
  draft: ContentDraft;
  /**
   * Where the page is live, as the editor holds it (CE-013: marked published
   * since it opened): the Live page tab measures it, else the page it optimizes.
   */
  liveUrl?: string | null;
  /** Published, as the editor holds it: without an address, the Live page tab asks for it. */
  published?: boolean;
  /** The brand's business type as the editor holds it (Quality CE-056). */
  siteType: SiteType;
  /** The draft's title, page and type as written now: Sources and Brief read them. */
  title: string;
  bodyHtml: string;
  pageType: string | null;
  /** The rules, as the editor checks them (the header's chip shows the same). */
  rules: DraftRulesState;
  /** The brand's rules from Settings › Content (00450), above the page's own in Rules. */
  brandRules?: { rules: string[]; brandName: string };
  /** The draft's brief and sources, read once for the editor. */
  reads: DraftReads;
  /**
   * A tab to open, from outside the panel (the header's rules chip), and a
   * source to show in Sources (a "Based on" chip or mark, CE-033).
   */
  tabRequest: {
    tab: PanelTarget;
    n: number;
    source?: { kind: DraftSourceKind; ref: string };
    /** The brief to build (the Next step basket's Build brief). */
    build?: boolean;
    /** Brief › Your input to show (Quality's Add, CE-048). */
    input?: boolean;
    /** Quality's part to show (the Next step basket's Show to-dos, Show what raises Trust). */
    focus?: QualityFocus;
  } | null;
  /** Run Agent's Fix open rules, for Rules (CE-018, v1.1 CE-029). */
  agentFix?: AgentFix;
  /** Run Agent ▾'s Rewrite the whole page, for Rules; absent once the page is ready or published. */
  pageRewrite?: PageRewrite;
  /** Rewrite from brief, for Brief; absent once the page is ready or published. */
  agentRewrite?: AgentRewrite;
  /** When the agent's latest suggestions came, or null: the last time it wrote from the sources. */
  lastSuggestionAt: string | null;
  /** The source asked for was shown (or isn't listed): it isn't shown again. */
  onSourceShown?: () => void;
  /** The brief asked for is being built: the request is spent. */
  onBuildStarted?: () => void;
  /**
   * Whether the agent is writing the brief: the agent card shows it working
   * (CE-027); `onServer` once the server writes it (the page can be left).
   */
  onBriefRebuilding?: (rebuilding: boolean, onServer: boolean) => void;
  /** Why the brief's Run Agent waits (another agent run from this page), or null. */
  briefBlocked?: string | null;
  /** What Quality reads from the draft and its author (CE-036/039), with Quality on. */
  quality?: QualityRead | null;
  /** The scores' average, as the header's chip shows it. */
  qualityScore?: number | null;
  /** Scrolls the draft to a passage and marks it: Quality's Show. */
  onShowInPage?: (text: string) => void;
  /** Selects the page's first placeholder (Quality's to-do, CE-044). */
  onShowPlaceholder?: () => void;
  /** Opens the header's author menu: Quality's Pick author. */
  onPickAuthor?: () => void;
  /** Brief › Your input (CE-048), with Quality's second phase. */
  yourInput?: DraftInputsRead | null;
  /** Opens Brief › Your input: Quality's Add. */
  onAddInput?: () => void;
  /** Quality's tick boxes for the author the site names (00271). */
  onConfirmAuthor?: (what: 'real' | 'profile', on: boolean) => void;
  /** Keeps a weak source or a competitor's on the page (Quality CE-046), once phase 2 is live. */
  onKeepSource?: (url: string) => void;
  /** Selects a claim's words and opens the link dialog on them: Quality's Add source (CE-045). */
  onAddSource?: (claim: ClaimMark) => void;
  /** Takes a claim's sentence out of the page: Quality's Remove (CE-045). */
  onRemoveClaim?: (claim: ClaimMark) => void;
  /** Quality's visual proof (CE-049): Confirm the page's images, or Add image at a spot. */
  onConfirmImages?: () => void;
  onAddImage?: () => void;
  /** Quality's Pick reviewer: the header's reviewer menu (CE-049). */
  onPickReviewer?: () => void;
  /** Quality's Add line for a comparison's check date (CE-052). */
  onAddCheckDate?: () => void;
  /** Quality's Confirm on a customer case (CE-052). */
  onConfirmCase?: (key: string) => void;
  /** Quality's Confirm on a category intro's facts (CE-054). */
  onConfirmIntro?: () => void;
  /** Quality's Change: the header's page type menu (CE-052). */
  onChangeType?: () => void;
  /** Hand it off to Content Agent, Quality's (CE-051). */
  handOff?: HandOff | null;
  /** Quality's Site Audit estimate (customer priorities item 9). */
  auditEstimate?: ReactNode;
  /** Brief › Shopping path changed: the Shopping rules read it again (shopping path, part 6). */
  onShoppingPathChange?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.panel');
  const tEditor = useTranslations('contentEditor.editor');
  const [tab, setTab] = useState<PanelTab>('instructions');
  const [segment, setSegment] = useState<InstructionSegment>('rules');
  const [opened, setOpened] = useState<Set<PanelTarget>>(() => new Set(['instructions', 'rules']));
  const describeRule = useRuleDescriber();
  // A read-only workspace (plan not active): Your input's changes open the
  // upgrade dialog instead (the tabs gate their own actions).
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The rules as checked; described only when a rebuild asks for them, not on every keystroke.
  const page = useRef({ title, html: bodyHtml, length: rules.length, checks: rules.rules });
  const sourcesNow = useRef(reads.sources);
  useEffect(() => {
    page.current = { title, html: bodyHtml, length: rules.length, checks: rules.rules };
    sourcesNow.current = reads.sources;
  });

  const open = (next: PanelTarget) => {
    const nextTab = isSegment(next) ? 'instructions' : next;
    if (isSegment(next)) setSegment(next);
    setTab(nextTab);
    setOpened((prev) =>
      prev.has(next) && prev.has(nextTab) ? prev : new Set([...prev, next, nextTab]),
    );
  };
  // None said while the count is still read (the header's chip says so).
  const rulesOpen = rules.settled === false ? 0 : Math.max(0, rules.total - rules.met);
  // Every rule open is the person's to decide (tried by the agent, or held): amber, not red.
  const rulesYours = rules.rules
    .filter(({ rule, status }) => rule.on && status.state === 'bad')
    .every(({ rule }) => agentFix?.tried?.has(rule.key) || agentFix?.held?.has(rule.key));
  // Quality shows once its first phase is live (NEXT_PUBLIC_CONTENT_QUALITY_PHASE).
  const segments = SEGMENTS.filter((value) => value !== 'quality' || qualityPhase() >= 1);

  // The sources the agent writes from, as the Sources tab keeps them (v1.1
  // CE-032/034): counted under each Run Agent and on the tab, so turning one
  // off there lowers both at once.
  const sourceCounts = useMemo(
    () =>
      reads.sources?.data
        ? includedCounts(
            buildSourceGroups(reads.sources.data, reads.sources.choices, {
              title,
              sourceUrl: draft.sourceUrl,
            }),
          )
        : null,
    [reads.sources, title, draft.sourceUrl],
  );
  // GetCito data Your input offers: the draft's prompts with answers, those
  // it targets first, the most answered first.
  const inputPrompts = useMemo<InputPrompt[]>(
    () =>
      (reads.sources?.data?.prompts ?? [])
        .filter((p) => p.answers > 0)
        .sort((a, b) => Number(b.inDraft) - Number(a.inDraft) || b.answers - a.answers)
        .map(({ id, text, answers, mentioned }) => ({ id, text, answers, mentioned })),
    [reads.sources],
  );
  const sourcesInUse = sourceCounts ? Object.values(sourceCounts).reduce((a, b) => a + b, 0) : null;
  const dataLine = sourceCounts && (
    <UsesYourData counts={sourceCounts} onEdit={() => open('sources')} />
  );
  // The last time the agent wrote from them: its latest run's suggestions,
  // the brief it built, or its writing the page (Start, Rewrite from brief),
  // unless that run failed.
  const builtAt = reads.brief.status === 'ready' ? (reads.brief.brief?.builtAt ?? null) : null;
  const wroteAt = draft.agentState === 'failed' ? null : draft.agentSince;
  const agentUsedAt =
    [lastSuggestionAt, builtAt, wroteAt]
      .filter((at): at is string => !!at && Number.isFinite(Date.parse(at)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1) ?? null;

  const requested = tabRequest?.n;
  useEffect(() => {
    if (tabRequest) open(tabRequest.tab);
    // Only a new request opens a tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const briefOpened = opened.has('brief');

  const { rebuilding, onServer, rebuild } = useBriefRebuild({
    draft,
    pageNow: (): PageNow => {
      const { checks, ...now } = page.current;
      return { ...now, rules: rulesForBrief(checks, describeRule) };
    },
    sourcesNow: () => sourcesNow.current,
    onSourcesRead: (read) => reads.setSources(read),
    onRebuilt: (next) => {
      reads.setBrief(next);
      open('brief');
    },
  });

  // Build brief from the Next step basket: once per request (an effect run
  // twice, as in development, builds once), never on a panel opened again
  // later; one that can't run says why.
  const buildHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!tabRequest?.build || buildHandled.current === tabRequest.n) return;
    buildHandled.current = tabRequest.n;
    onBuildStarted?.();
    if (briefBlocked) toast(briefBlocked);
    else if (!rebuilding) void rebuild();
    // Only a new request builds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // The agent card shows the brief's run too, with its steps and Stop, and
  // whether it is on the server yet; a panel closed meanwhile says it no
  // longer waits on it.
  useEffect(() => {
    onBriefRebuilding?.(rebuilding, onServer);
    return () => onBriefRebuilding?.(false, false);
  }, [rebuilding, onServer, onBriefRebuilding]);

  return (
    <aside aria-label={t('label')} className="flex w-[400px] shrink-0 flex-col border-l bg-card">
      <Tabs
        value={tab}
        onValueChange={(value) => open(value as PanelTab)}
        className="border-b px-3 pt-1.5"
      >
        <TabsList variant="line">
          {PANEL_TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
              {/* The rules still open, on the tab that holds them. */}
              {value === 'instructions' && rulesOpen > 0 && (
                <>
                  <span
                    aria-hidden
                    className="rounded-md bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                  >
                    {rulesOpen}
                  </span>
                  <span className="sr-only">{t('openRules', { count: rulesOpen })}</span>
                </>
              )}
              {/* The sources in use (CE-034), the number in full on hover. */}
              {value === 'sources' && !!sourcesInUse && (
                <>
                  <span
                    aria-hidden
                    title={t('sourcesInUse', { count: sourcesInUse })}
                    className="rounded-md bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground"
                  >
                    {formatNumber(sourcesInUse)}
                  </span>
                  <span className="sr-only">{t('sourcesInUse', { count: sourcesInUse })}</span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {/* The panel's own scroll: a part shown in it scrolls here, never the page (scrollInPanel). */}
      <div data-panel-scroll className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div hidden={tab !== 'instructions'} className="space-y-4">
          <DataNote />
          <div
            role="radiogroup"
            aria-label={t(segments.length > 2 ? 'segmentsLabelQuality' : 'segmentsLabel')}
            className="flex rounded-[10px] border bg-muted p-[3px]"
            // Arrow keys move between them, as in any radio group.
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
              const next =
                segments[(segments.indexOf(segment) + step + segments.length) % segments.length];
              open(next);
              e.currentTarget.querySelector<HTMLElement>(`[data-segment="${next}"]`)?.focus();
            }}
          >
            {segments.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                data-segment={value}
                aria-checked={segment === value}
                tabIndex={segment === value ? 0 : -1}
                onClick={() => open(value)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1 text-[13px] font-medium text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  segment === value && 'bg-background text-foreground shadow-xs',
                )}
              >
                {t(`segments.${value}`)}
                {value === 'rules' && rulesOpen > 0 && (
                  <span
                    className={cn(
                      'rounded-md px-1.5 text-[10.5px] font-medium',
                      // Red only for what blocks: open rules don't (editor UX review 2026-11-03).
                      rulesYours
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'border border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300',
                    )}
                  >
                    {t('segments.open', { count: rulesOpen })}
                  </span>
                )}
                {value === 'quality' && qualityScore !== null && (
                  <span
                    className={cn(
                      'rounded-md border px-1.5 text-[10.5px] font-medium tabular-nums',
                      BAND_CLASSES[qualityBand(qualityScore)],
                    )}
                  >
                    {qualityScore}
                    <span className="sr-only">
                      {' · '}
                      {tEditor(`quality.bands.${qualityBand(qualityScore)}`)}
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
          {briefOpened && (
            <div hidden={segment !== 'brief'} className="space-y-4">
              {yourInput?.status === 'ready' && (
                <YourInput
                  inputs={yourInput.inputs}
                  prompts={inputPrompts}
                  onChange={guard(yourInput.change, { action: tActions('saveInput') })}
                  // Once Brief shows: a hidden block can't be scrolled to.
                  scrollRequest={tabRequest?.input && segment === 'brief' ? tabRequest.n : null}
                />
              )}
              {yourInput?.status === 'failed' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {tEditor('yourInput.loadError')}
                  <button type="button" className="font-medium underline" onClick={yourInput.retry}>
                    {tEditor('yourInput.retry')}
                  </button>
                </p>
              )}
              {shoppingPathFits(siteType, pageType) && (
                <ShoppingPathSection
                  draftId={draft.id}
                  brandId={draft.brandId}
                  pageType={pageType}
                  onPathChange={onShoppingPathChange}
                />
              )}
              <BriefTab
                draftId={draft.id}
                state={reads.brief}
                pageType={pageType}
                length={rules.length}
                sourceUrl={draft.sourceUrl}
                method={draft.method}
                rebuilding={rebuilding}
                onRebuild={() => void rebuild()}
                onRetry={reads.reloadBrief}
                onSaved={(saved) => reads.setBrief(saved)}
                rewrite={agentRewrite}
                dataLine={dataLine}
                blocked={briefBlocked}
                given={yourInput?.status === 'ready' ? inputsGiven(yourInput.inputs) : null}
                onAddInput={onAddInput}
              />
            </div>
          )}
          {opened.has('quality') && quality && (
            <div hidden={segment !== 'quality'}>
              <QualityTab
                quality={quality}
                focusRequest={
                  tabRequest?.focus && segment === 'quality'
                    ? { to: tabRequest.focus, n: tabRequest.n }
                    : null
                }
                onShow={(text) => onShowInPage?.(text)}
                onShowPlaceholder={() => onShowPlaceholder?.()}
                onPickAuthor={() => onPickAuthor?.()}
                onAddInput={onAddInput}
                onConfirmAuthor={onConfirmAuthor}
                onKeep={onKeepSource}
                onAddSource={onAddSource}
                onRemove={onRemoveClaim}
                onConfirmImages={onConfirmImages}
                onAddImage={onAddImage}
                onPickReviewer={onPickReviewer}
                onAddCheckDate={onAddCheckDate}
                onConfirmCase={onConfirmCase}
                onConfirmIntro={onConfirmIntro}
                onChangeType={onChangeType}
                handOff={handOff}
                auditEstimate={auditEstimate}
              />
            </div>
          )}
          {opened.has('rules') && (
            <div hidden={segment !== 'rules'}>
              <RulesTab
                agentFix={agentFix}
                pageRewrite={pageRewrite}
                dataLine={dataLine}
                // Only a draft with no prompts gets no fan-outs for want of them.
                onOpenSources={
                  reads.sources && !reads.sources.failed && reads.sources.data.prompts.length === 0
                    ? () => open('sources')
                    : undefined
                }
                state={rules}
                siteType={siteType}
                draftPageType={isPageType(pageType) ? pageType : null}
                brandRules={brandRules}
              />
            </div>
          )}
        </div>
        {opened.has('sources') && (
          <div hidden={tab !== 'sources'}>
            <SourcesTab
              read={reads.sources}
              setRead={reads.setSources}
              onReload={reads.reloadSources}
              draftId={draft.id}
              brandId={draft.brandId}
              title={title}
              sourceUrl={draft.sourceUrl}
              bodyHtml={bodyHtml}
              rebuilding={rebuilding}
              blocked={briefBlocked}
              onRebuild={(sources) => void rebuild({ sources })}
              agentUsedAt={agentUsedAt}
              // Only while Sources shows: a hidden row can't be scrolled to.
              highlight={
                tab === 'sources' && tabRequest?.source
                  ? { ...tabRequest.source, n: tabRequest.n }
                  : null
              }
              onHighlighted={onSourceShown}
            />
          </div>
        )}
        {opened.has('impact') && (
          <div hidden={tab !== 'impact'}>
            <ImpactTab
              // Another address (marked published at it) reads anew, not the last one's numbers.
              key={liveUrl ?? draft.sourceUrl ?? 'none'}
              brandId={draft.brandId}
              pageUrl={liveUrl ?? draft.sourceUrl}
              published={published}
              rebuilding={rebuilding}
              blocked={briefBlocked}
              onUseLostPrompts={(promptIds) => void rebuild({ addPrompts: promptIds })}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
