'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeDomain } from '@/lib/citations/classify';
import type { ContentAuthor } from '@/lib/content/authors';
import { isPageType } from '@/lib/content/drafts';
import type { SiteType } from '@/lib/content/pageTypes';
import { BAND_CLASSES, qualityBand } from '@/lib/content/quality';
import type { QualityProfile } from '@/lib/content/qualityProfiles';
import {
  authorProfile,
  FRESH_MONTHS,
  trustGain,
  type EeatCheckId,
  type Score,
  type ClaimMark,
  type TrustCheckId,
  type TrustRead,
} from '@/lib/content/qualityChecks';
import type { QualityTodo } from '@/lib/content/qualityTodos';
import type { AiCheck } from '@/lib/content/pageRead';
import {
  readabilityGain,
  SECTION_WORDS,
  type Readability,
  type ReadabilityCheck,
} from '@/lib/content/readability';
import { SITE_TRUST_PATH, siteTrustMissing, type SiteTrust } from '@/lib/content/siteTrust';
import { CATALOG_SETTINGS_PATH } from '@/lib/content/feedMatch';
import { cn } from '@/lib/utils';
import { MANAGE_AUTHORS_PATH } from './_AuthorMenu';

/** The intro's sentences its to-do quotes, at most (CE-054). */
const INTRO_QUOTED = 3;

/** What Quality reads from the draft and its author, for the segment and the header. */
export interface QualityRead {
  /**
   * Phase 3 (CE-052): the page's customer cases' sentences: the person
   * confirms them, so Hand off never sources or removes them.
   */
  caseSentences?: string[];
  /**
   * Phase 3 (CE-052): the page type the checks and weights follow, whether
   * it was detected (not picked), and its profile; left out before.
   */
  weightsFor?: { type: string | null; detected: boolean; profile: QualityProfile } | null;
  /**
   * Phase 3 (CE-053): why a product page isn't checked against a product
   * feed: no catalog connected, or none of its products is the page's;
   * null where it is checked, or isn't a product page.
   */
  feed?: 'none' | 'notFound' | null;
  /** The page's Readability as written, or null before it is read. */
  readability: Readability | null;
  /** E-E-A-T from the author, or null before the authors are read. */
  eeat: Score<EeatCheckId> | null;
  /** Trust from the page's figures and links, its score null until a figure or a dated source is read. */
  trust: TrustRead | null;
  /** The page's author, or null for the organization byline. */
  author: ContentAuthor | null;
  /** Whether the member reading may edit that author in Settings › Authors. */
  canEdit: boolean;
  /** Whether the workspace has an author to pick (Settings › Authors). */
  hasAuthors: boolean;
  brandName: string;
  /** The brand's team as the page goes out without an author, in its language (teamName). */
  team: string;
  /** The site's trust in Site Audit (CE-043), or null while not read. */
  siteTrust: SiteTrust | null;
  /** What only the person can do (qualityTodos, CE-040). */
  todos: QualityTodo[];
  /** The model's reads of sources wait: the workspace's AI budget is spent (CE-046). */
  aiPaused?: boolean;
  /** The model's reads of the claims wait, for the same reason (CE-045). */
  claimsPaused?: boolean;
  /** The draft's claim reads for the day are made (CE-045). */
  claimsLimited?: boolean;
  /** Some of the page's claims aren't read yet: Trust may change (CE-045). */
  claimsReading?: boolean;
  /** Where the brand's facts are approved: Brand settings › Brand facts (CE-047). */
  brandFactsPath?: string | null;
  /** The brand's business type: a proof to-do's wording follows it (CE-049). */
  siteType?: SiteType;
  /** The page read (proof, CE-049; AI checks, CE-050) waits: the AI budget is spent, or its reads for the day made. */
  pagePaused?: boolean;
  pageLimited?: boolean;
  /** The page read is under way: its to-dos and AI checks may change. */
  pageReading?: boolean;
  /** The page read's AI checks, where they apply (aiChecksOnPage, CE-050). */
  aiChecks?: {
    balanced: AiCheck | null;
    disclosure: AiCheck | null;
  } | null;
  /**
   * With no author picked, what the person confirmed of the author their
   * site names (00271): a real person, and their profile there.
   */
  authorConfirmed?: { real: boolean; profile: boolean };
  /** A confirmation being saved: the boxes wait for it. */
  authorConfirming?: boolean;
}

type ScoreName = 'eeat' | 'trust' | 'readability';

/** Hand it off to Content Agent (Quality spec §5, CE-051), as the editor runs it. */
export interface HandOff {
  run: () => void;
  running: boolean;
  /** Why it can't run now (suggestions still open, AI usage spent, reads under way), or null. */
  blocked: string | null;
  /** The suggestions it fixes in one run, and the to-dos that stay the person's. */
  count: number;
  todos: number;
}

export interface Suggestion {
  key: string;
  // E-E-A-T's are the person's to-dos.
  score: Exclude<ScoreName, 'eeat'>;
  gain: number;
  line: string;
  detail: string;
  /** The passage Show goes to, if any. */
  show: string | null;
  /** The source Keep keeps (CE-046): the person trusts it all the same. */
  keep?: string;
  /** The claim whose words Add source selects to link, and whose sentence Remove takes out (CE-045). */
  claim?: ClaimMark;
  /** Read by AI, not by rules alone: it says so (spec §3, "AI check"). */
  ai?: boolean;
  /**
   * Hand off leaves it to the person (CE-051): it asks the other way to what
   * the agent is told for its check (sentences too short, a page too simple).
   */
  handOff?: false;
}

/**
 * Instructions › Quality (Quality spec §3, CE-039): the three scores read
 * from the draft and its author, each labelled an GetCito estimate, then
 * what only the person can do (Your to-dos, CE-040) and what would raise
 * them, the biggest gain first. A score shows once one of its checks is
 * live for the page.
 */
export function QualityTab({
  quality,
  focusRequest = null,
  onShow,
  onShowPlaceholder,
  onPickAuthor,
  onAddInput,
  onKeep,
  onAddSource,
  onRemove,
  onConfirmImages,
  onAddImage,
  onPickReviewer,
  onAddCheckDate,
  onConfirmCase,
  onConfirmIntro,
  handOff = null,
  onConfirmAuthor,
  onChangeType,
  auditEstimate = null,
}: {
  quality: QualityRead;
  /**
   * A part to show, from the Next step basket: scrolled into view and
   * marked a moment, Quality open already or not (editor test 2026-11-03).
   */
  focusRequest?: { to: QualityFocus; n: number } | null;
  /** Site Audit's estimate of the page (customer priorities item 9), under the scores. */
  auditEstimate?: ReactNode;
  /** Opens the header's page type menu: the checks and weights follow the type (CE-052). */
  onChangeType?: () => void;
  /** Scrolls the draft to a passage and marks it. */
  onShow: (text: string) => void;
  /** Selects the page's first placeholder, to type over. */
  onShowPlaceholder: () => void;
  /** Opens the header's author menu. */
  onPickAuthor: () => void;
  /** Opens Brief › Your input (CE-048). */
  onAddInput?: () => void;
  /** Keeps a weak source or a competitor's on the page (CE-046). */
  onKeep?: (url: string) => void;
  /** Selects a claim's words and opens the link dialog on them (CE-045). */
  onAddSource?: (claim: ClaimMark) => void;
  /** Ticks or unticks what the person confirms of the author their site names (00271). */
  onConfirmAuthor?: (what: 'real' | 'profile', on: boolean) => void;
  /** Takes a claim's sentence out of the page (CE-045). */
  onRemove?: (claim: ClaimMark) => void;
  /** Opens Confirm: the page's images, each to confirm as the person's own (CE-049). */
  onConfirmImages?: () => void;
  /** Opens the first open visual proof spot's Add image (CE-049). */
  onAddImage?: () => void;
  /** Opens the header's reviewer menu (CE-049). */
  onPickReviewer?: () => void;
  /** A comparison's check date to-do: Add line puts this month's under the answer (CE-052). */
  onAddCheckDate?: () => void;
  /** A customer case's Confirm: the person says the customer may be named (CE-052). */
  onConfirmCase?: (key: string) => void;
  /** Phase 3 (CE-054): confirms a category intro's facts, all at once. */
  onConfirmIntro?: () => void;
  /** Hand it off to Content Agent (CE-051): with Quality's phase 2. */
  handOff?: HandOff | null;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const tSite = useTranslations('audit.siteTrust.checks');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const format = useFormatter();
  const { readability, eeat, trust, siteTrust, weightsFor } = quality;
  const siteMissing = siteTrust ? siteTrustMissing(siteTrust) : [];
  const scores: { name: ScoreName; score: number | null; empty: string }[] = [
    { name: 'eeat', score: eeat?.score ?? null, empty: t('notScored') },
    { name: 'trust', score: trust?.score ?? null, empty: t('notScored') },
    { name: 'readability', score: readability?.score ?? null, empty: t('tooShortShort') },
  ];
  const { todos } = quality;
  const todosLeft = todos.filter((todo) => !todo.done).length;
  const suggestions = qualitySuggestions(t, quality);
  // Every live check has its points: none to raise, none of the person's left
  // (a page too short to read says so instead).
  const allDone = suggestions.length === 0 && todosLeft === 0 && readability?.score !== null;
  const shown = useFocusRequest(focusRequest, todosLeft > 0, suggestions.length > 0);

  return (
    <div className="space-y-4 text-sm">
      <section
        ref={shown.ref('scores')}
        tabIndex={-1}
        aria-label={t('scores')}
        className={cn('space-y-2', shown.mark('scores'))}
      >
        <div className="grid grid-cols-3 gap-2">
          {scores.map(({ name, score, empty }) => (
            <div key={name} className="min-w-0 rounded-xl border bg-card px-2.5 py-2">
              <p className="truncate text-xs text-muted-foreground">{t(`names.${name}`)}</p>
              {/* What it measures, in plain words (editor UX review 2026-11-03). */}
              <p className="text-[11px] leading-tight text-muted-foreground">
                {t(`about.${name}`)}
              </p>
              {score === null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{empty}</p>
              ) : (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-xl font-semibold tabular-nums">{score}</span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 text-[10.5px] font-medium',
                      BAND_CLASSES[qualityBand(score)],
                    )}
                  >
                    {t(`bands.${qualityBand(score)}`)}
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('bandsLegend')}</p>
        <p className="text-xs text-muted-foreground">{t('estimate')}</p>
        {weightsFor && (
          <p className="text-xs text-muted-foreground">
            {t('weightsFor.line', {
              type: isPageType(weightsFor.type) ? tTypes(weightsFor.type) : t('weightsFor.noType'),
              detected: weightsFor.detected && isPageType(weightsFor.type) ? 'yes' : 'no',
            })}{' '}
            {t(`weightsFor.${weightsFor.profile}`)}
            {onChangeType && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onChangeType}
                  aria-label={t('weightsFor.changeLabel')}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {t('weightsFor.change')}
                </button>
              </>
            )}
          </p>
        )}
        {auditEstimate}
        {quality.feed && (
          <p className="text-xs text-muted-foreground">
            {t(`feed.${quality.feed}`)}
            {quality.feed === 'none' && (
              <>
                {' '}
                <Link
                  href={CATALOG_SETTINGS_PATH}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {t('feed.connect')}
                </Link>
              </>
            )}
          </p>
        )}
        {readability?.score === null && (
          <p className="rounded-xl border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
            {t(readability?.unscored === 'language' ? 'notThisLanguage' : 'tooShort')}
          </p>
        )}
      </section>

      {handOff && <HandOffCard handOff={handOff} />}

      {todos.length > 0 && (
        <section
          ref={shown.ref('todos')}
          tabIndex={-1}
          aria-label={t('todos.title')}
          className={cn('space-y-2', shown.mark('todos'))}
        >
          <h4 className="text-xs text-muted-foreground">
            <span className="font-medium">{t('todos.title')}</span>{' '}
            {t('todos.left', { count: todosLeft })}
          </h4>
          <ul className="space-y-2">
            {todos.map((todo) => (
              <TodoRow
                key={todo.key ?? todo.id}
                todo={todo}
                quality={quality}
                onShowPlaceholder={onShowPlaceholder}
                onPickAuthor={onPickAuthor}
                onAddInput={onAddInput}
                onAddSource={onAddSource}
                onConfirmImages={onConfirmImages}
                onAddImage={onAddImage}
                onPickReviewer={onPickReviewer}
                onAddCheckDate={onAddCheckDate}
                onConfirmCase={onConfirmCase}
                onConfirmIntro={onConfirmIntro}
                onConfirm={onConfirmAuthor}
              />
            ))}
          </ul>
        </section>
      )}

      {(suggestions.length > 0 || allDone) && (
        <section
          ref={shown.ref('trust')}
          tabIndex={-1}
          aria-label={t('suggestionsLabel')}
          className={cn('space-y-2', shown.mark('trust'))}
        >
          <h4 className="text-xs font-medium text-muted-foreground">{t('suggestionsLabel')}</h4>
          {allDone ? (
            <p className="text-xs text-muted-foreground">{t('nothingToRaise')}</p>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => (
                <li key={s.key} className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
                  <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                    <span title={t('gainLong', { gain: s.gain, score: t(`names.${s.score}`) })}>
                      {t('gain', { gain: s.gain, score: t(`names.${s.score}`) })}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {s.line}
                      {s.ai && (
                        <span className="ml-1.5 inline-block rounded border px-1 align-middle text-[10.5px] font-normal text-muted-foreground">
                          {t('aiCheck')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {s.detail}
                    </p>
                  </div>
                  {(s.show !== null ||
                    (s.claim && (onAddSource || onRemove)) ||
                    (s.keep && onKeep)) && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {s.show !== null && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => onShow(s.show!)}
                        >
                          {t('show')}
                        </Button>
                      )}
                      {s.claim && onAddSource && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          aria-label={t('addSourceTo', { claim: s.claim.text })}
                          onClick={() => onAddSource(s.claim!)}
                        >
                          {t('addSource')}
                        </Button>
                      )}
                      {s.keep && onKeep && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => onKeep(s.keep!)}
                        >
                          {t('keep')}
                        </Button>
                      )}
                      {s.claim && onRemove && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          aria-label={t('removeClaim', { sentence: s.claim.sentence })}
                          onClick={() => onRemove(s.claim!)}
                        >
                          {t('remove')}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {quality.aiPaused && <p className="text-xs text-muted-foreground">{t('aiPaused')}</p>}
      {quality.claimsPaused && <p className="text-xs text-muted-foreground">{t('claimsPaused')}</p>}
      {quality.pagePaused && <p className="text-xs text-muted-foreground">{t('pagePaused')}</p>}
      {quality.pageLimited && !quality.pagePaused && (
        <p className="text-xs text-muted-foreground">{t('pageLimited')}</p>
      )}
      {quality.claimsLimited && !quality.claimsPaused && (
        <p className="text-xs text-muted-foreground">{t('claimsLimited')}</p>
      )}

      {siteTrust && (
        <section
          aria-label={t('site.label')}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-xs"
        >
          <span className="font-medium">{t('site.score', { score: siteTrust.score })}</span>
          {siteMissing.length > 0 && (
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              <span aria-hidden>· </span>
              {t('site.missing', {
                checks: format.list(siteMissing.map((check) => tSite(`${check}.name`))),
              })}
            </span>
          )}
          {siteMissing.length > 0 && (
            <Link
              href={SITE_TRUST_PATH}
              className="ml-auto font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t('site.fix')}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}

/** Quality's parts the Next step basket shows: its to-dos, or what raises Trust. */
export type QualityFocus = 'todos' | 'trust';
type FocusPart = QualityFocus | 'scores';

/**
 * Brings a part of the side panel to the top of the panel's own scroll
 * (`data-panel-scroll`), leaving the page where it is: scrollIntoView moves
 * every scroll it sits in, and at 1024×768 took the header with Next and
 * Mark ready out of sight (editor UX review 2026-11-03). Outside the panel,
 * as near as it needs.
 */
export function scrollInPanel(el: HTMLElement) {
  const box = el.closest<HTMLElement>('[data-panel-scroll]');
  if (!box) {
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    return;
  }
  const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  box.scrollTo?.({ top: Math.max(0, top - 8), behavior: 'smooth' });
}

/** How long a part shown from the basket stays marked. */
const FOCUS_MARK_MS = 1600;

/**
 * The part a request names, scrolled into view, focused and marked a moment
 * (once per request): its to-dos with one open, else what raises the
 * scores, else the scores themselves.
 */
function useFocusRequest(
  request: { to: QualityFocus; n: number } | null,
  hasTodos: boolean,
  hasSuggestions: boolean,
) {
  const parts = useRef<Partial<Record<FocusPart, HTMLElement | null>>>({});
  const handled = useRef<number | null>(null);
  const [marked, setMarked] = useState<FocusPart | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.n) return;
    handled.current = request.n;
    const order: FocusPart[] =
      request.to === 'todos' ? ['todos', 'trust', 'scores'] : ['trust', 'todos', 'scores'];
    const part = order.find(
      (p) => (p === 'scores' || (p === 'todos' ? hasTodos : hasSuggestions)) && parts.current[p],
    );
    const el = part ? parts.current[part] : null;
    if (!part || !el) return;
    scrollInPanel(el);
    el.focus({ preventScroll: true });
    setMarked(part);
    const timer = setTimeout(() => setMarked(null), FOCUS_MARK_MS);
    return () => clearTimeout(timer);
    // Only a new request shows a part.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);
  return {
    ref: (part: FocusPart) => (el: HTMLElement | null) => {
      parts.current[part] = el;
    },
    mark: (part: FocusPart) =>
      cn(
        'rounded-xl outline-none transition-shadow duration-500',
        marked === part &&
          'ring-2 ring-amber-300 ring-offset-2 ring-offset-background dark:ring-amber-700',
      ),
  };
}

/** A to-do's words: its title, the nudge's "Next for you" phrase and its detail line. */
export function useTodoCopy() {
  const t = useTranslations('contentEditor.editor.quality.todos');
  return (
    todo: QualityTodo,
    {
      author,
      team,
      canEdit,
      siteType,
    }: Pick<QualityRead, 'author' | 'team' | 'canEdit'> & Partial<Pick<QualityRead, 'siteType'>>,
  ) => {
    if (todo.id === 'placeholders') {
      const count = todo.count ?? 0;
      return {
        title: t('placeholders.title', { count }),
        next: t('placeholders.next', { count }),
        detail: todo.done ? t('placeholders.done') : t('placeholders.detail'),
      };
    }
    if (todo.id === 'byline') {
      const action = todo.action === 'addAuthor' ? 'addAuthor' : 'pickAuthor';
      return {
        title: t(`byline.title.${action}`),
        next: t(`byline.next.${action}`),
        detail:
          todo.done && author
            ? t('byline.done', { name: author.name })
            : todo.done
              ? t('byline.confirmedDone')
              : action === 'addAuthor'
                ? t('byline.detail.addAuthor')
                : t('byline.detail.pickAuthor', { byline: team }),
      };
    }
    // A category intro's counts and prices (CE-054): only the person knows them.
    if (todo.id === 'introFacts') {
      const facts = todo.facts ?? [];
      return {
        title: t('introFacts.title'),
        next: t('introFacts.next'),
        detail: todo.done
          ? t('introFacts.done')
          : t('introFacts.detail', {
              facts: facts
                .slice(0, INTRO_QUOTED)
                .map((fact) => `“${fact}”`)
                .join(' '),
              more: Math.max(0, facts.length - INTRO_QUOTED),
            }),
      };
    }
    // The page's own claims, their proof asked for by kind and business (CE-049).
    // A customer case in Phase 3 (CE-052): confirmed publishable, not linked.
    if (todo.id === 'proof' && todo.proof && todo.action === 'confirmCase') {
      return {
        title: t('proof.confirmCase.title', { claim: todo.proof.claim }),
        next: t('proof.confirmCase.next'),
        detail: [
          todo.done ? t('proof.confirmCase.done') : t('proof.confirmCase.detail'),
          ...(todo.trustGain ? [t('proof.confirmCase.link', { gain: todo.trustGain })] : []),
        ].join('. '),
      };
    }
    if (todo.id === 'proof' && todo.proof) {
      const { claim, kind } = todo.proof;
      return {
        title: t(`proof.title.${kind}`, { claim, site: siteType ?? 'b2b' }),
        next: t('proof.next', { claim }),
        detail: todo.done
          ? t('proof.done')
          : kind === 'ranking' || kind === 'unknown'
            ? t('proof.detail.soften')
            : kind === 'customer_case'
              ? t('proof.detail.customerCase')
              : t('proof.detail.default'),
      };
    }
    // The brand's facts read from its site, to approve (CE-047).
    if (todo.id === 'brandFacts') {
      const count = todo.count ?? 0;
      return {
        title: t('brandFacts.title', { count }),
        next: t('brandFacts.next', { count }),
        detail: todo.done ? t('brandFacts.done') : t('brandFacts.detail'),
      };
    }
    // A qualified reviewer for a page that advises on health, finance or law (CE-049).
    if (todo.id === 'reviewer') {
      const topic = todo.topic ?? 'health';
      return {
        title: t('reviewer.title'),
        next: t('reviewer.next'),
        detail: todo.done
          ? t('reviewer.done')
          : todo.action === 'addAuthor'
            ? t('reviewer.detail.addAuthor', { topic })
            : t('reviewer.detail.pick', { topic }),
      };
    }
    // An image the person took themself (CE-049).
    if (todo.id === 'visualProof') {
      const count = todo.count ?? 0;
      return {
        title: t('visualProof.title'),
        next: t('visualProof.next'),
        detail: todo.done
          ? t('visualProof.done')
          : todo.action === 'confirmImage'
            ? t('visualProof.detail.confirm', { count })
            : t('visualProof.detail.add'),
      };
    }
    // A comparison's check date (CE-052): only the person knows when they checked.
    if (todo.id === 'checkDate') {
      return {
        title: t(todo.old && !todo.done ? 'checkDate.titleOld' : 'checkDate.title'),
        next: t('checkDate.next'),
        detail: todo.done
          ? t('checkDate.done')
          : todo.action === 'addCheckDate'
            ? t(
                todo.old === 'line'
                  ? 'checkDate.detailReplace'
                  : todo.old === 'text'
                    ? 'checkDate.detailOld'
                    : 'checkDate.detail',
              )
            : t('checkDate.detailWrite'),
      };
    }
    // A product page's shipping and returns (CE-052): only the person knows them.
    if (todo.id === 'shippingReturns') {
      return {
        title: t('shippingReturns.title'),
        next: t('shippingReturns.next'),
        detail: todo.done ? t('shippingReturns.done') : t('shippingReturns.detail'),
      };
    }
    // How the page was made (CE-050): the page read finds it or not.
    if (todo.id === 'whoHowWhy') {
      return {
        title: t('whoHowWhy.title'),
        next: t('whoHowWhy.next'),
        detail: todo.done ? t('whoHowWhy.done') : t('whoHowWhy.detail'),
      };
    }
    // What only the person can give (Brief › Your input, CE-048).
    if (todo.id === 'experience' || todo.id === 'originalData' || todo.id === 'expertQuote') {
      return {
        title: t(`${todo.id}.title`),
        next: t(`${todo.id}.next`),
        detail: todo.done
          ? t(`${todo.id}.done`)
          : todo.given
            ? t(`${todo.id}.given`)
            : t(`${todo.id}.detail`),
      };
    }
    if (!author) {
      return {
        title: t('authorProfile.titleNoAuthor'),
        next: t('authorProfile.nextNoAuthor'),
        // Once the person confirmed a real author their site names, their profile there may be too.
        detail: todo.done
          ? t('authorProfile.confirmedDone')
          : todo.confirm
            ? t('authorProfile.detail.confirm')
            : t('authorProfile.detail.noAuthor'),
      };
    }
    const { bio, links } = authorProfile(author);
    const missing = !bio && !links ? 'both' : !bio ? 'bio' : 'links';
    return {
      title: t('authorProfile.title', { name: author.name }),
      next: t('authorProfile.next', { name: author.name }),
      // Only whoever can edit the author is sent to; anyone else is told who can.
      detail: todo.done
        ? t('authorProfile.done')
        : canEdit
          ? t(`authorProfile.detail.${missing}`)
          : t(`authorProfile.askOthers.${missing}`, {
              name: author.name,
              member: author.userId ? 'yes' : 'no',
            }),
    };
  };
}

/**
 * A to-do: its box (checked once done, which the checks decide), what to
 * do, what it adds, and its one button while open.
 */
function TodoRow({
  todo,
  quality,
  onShowPlaceholder,
  onPickAuthor,
  onAddInput,
  onAddSource,
  onConfirmImages,
  onAddImage,
  onPickReviewer,
  onAddCheckDate,
  onConfirmCase,
  onConfirmIntro,
  onConfirm,
}: {
  todo: QualityTodo;
  quality: QualityRead;
  onShowPlaceholder: () => void;
  onPickAuthor: () => void;
  onAddInput?: () => void;
  /** A proof to-do's Add proof link: its claim selected, the link dialog open (CE-049). */
  onAddSource?: (claim: ClaimMark) => void;
  onConfirmImages?: () => void;
  onAddImage?: () => void;
  onPickReviewer?: () => void;
  /** A comparison's check date to-do: Add line puts this month's under the answer (CE-052). */
  onAddCheckDate?: () => void;
  /** A customer case's Confirm: the person says the customer may be named (CE-052). */
  onConfirmCase?: (key: string) => void;
  /** Phase 3 (CE-054): confirms a category intro's facts, all at once. */
  onConfirmIntro?: () => void;
  onConfirm?: (what: 'real' | 'profile', on: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor.quality');
  const { title, detail } = useTodoCopy()(todo, quality);
  const confirmId = useId();
  const { confirm } = todo;
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
        todo.done && 'bg-muted/40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
          todo.done
            ? 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-emerald-950'
            : 'border-input bg-background',
        )}
      >
        {todo.done && <Check className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'font-medium [overflow-wrap:anywhere]',
            todo.done && 'text-muted-foreground line-through',
          )}
        >
          {title}
          <span className="sr-only">
            {' · '}
            {todo.done ? t('todos.done') : t('todos.open')}
          </span>
        </p>
        <p
          className={cn(
            'text-xs text-muted-foreground [overflow-wrap:anywhere]',
            todo.done && 'line-through',
          )}
        >
          {detail}
          {!todo.done && todo.gain > 0 && (
            <>
              {' · '}
              <span className="font-medium whitespace-nowrap text-emerald-700 tabular-nums dark:text-emerald-300">
                <span title={t('gainLong', { gain: todo.gain, score: t(`names.${todo.score}`) })}>
                  {t('gain', { gain: todo.gain, score: t(`names.${todo.score}`) })}
                </span>
              </span>
            </>
          )}
        </p>
        {/* Or the person's own word for the author their site names (00271). */}
        {confirm && onConfirm && (
          <div className="mt-1.5 flex items-start gap-2">
            <Checkbox
              id={confirmId}
              className="mt-px"
              checked={confirm.on}
              disabled={quality.authorConfirming}
              onCheckedChange={(on) => onConfirm(confirm.what, on === true)}
            />
            <label htmlFor={confirmId} className="text-xs leading-snug text-foreground">
              {t(`todos.confirm.${confirm.what}`)}
            </label>
          </div>
        )}
      </div>
      {!todo.done &&
        todo.action &&
        (todo.action === 'showPlaceholder' ? (
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onShowPlaceholder}>
            {t('show')}
          </Button>
        ) : todo.action === 'addInput' ? (
          onAddInput && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onAddInput}>
              {t('addInput')}
            </Button>
          )
        ) : todo.action === 'pickAuthor' ? (
          <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onPickAuthor}>
            {t('pickAuthor')}
          </Button>
        ) : todo.action === 'addProof' ? (
          onAddSource &&
          todo.proof && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              aria-label={t('addProofFor', { claim: todo.proof.claim })}
              onClick={() =>
                onAddSource({
                  text: todo.proof!.claim,
                  sentence: todo.proof!.sentence,
                  block: todo.proof!.block,
                })
              }
            >
              {t('addProof')}
            </Button>
          )
        ) : todo.action === 'confirmImage' ? (
          onConfirmImages && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onConfirmImages}>
              {t('confirmImage')}
            </Button>
          )
        ) : todo.action === 'addImage' ? (
          onAddImage && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onAddImage}>
              {t('addImage')}
            </Button>
          )
        ) : todo.action === 'pickReviewer' ? (
          onPickReviewer && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onPickReviewer}>
              {t('pickReviewer')}
            </Button>
          )
        ) : todo.action === 'confirmCase' ? (
          onConfirmCase &&
          todo.key && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0"
              onClick={() => onConfirmCase(todo.key!)}
            >
              {t('confirmCase')}
            </Button>
          )
        ) : todo.action === 'confirmIntro' ? (
          onConfirmIntro && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onConfirmIntro}>
              {t('confirmCase')}
            </Button>
          )
        ) : todo.action === 'addCheckDate' ? (
          onAddCheckDate && (
            <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onAddCheckDate}>
              {t('addLine')}
            </Button>
          )
        ) : todo.action === 'reviewBrandFacts' ? (
          quality.brandFactsPath && (
            <Link
              href={quality.brandFactsPath}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 shrink-0')}
            >
              {t('reviewBrandFacts')}
            </Link>
          )
        ) : (
          <Link
            href={MANAGE_AUTHORS_PATH}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 shrink-0')}
          >
            {t(todo.action)}
          </Link>
        ))}
    </li>
  );
}

type T = ReturnType<typeof useTranslations<'contentEditor.editor.quality'>>;

function readabilitySuggestions(t: T, readability: Readability | null): Suggestion[] {
  if (!readability || readability.score === null) return [];
  return readability.checks.map((check): Suggestion => ({
    key: `readability:${check.id}`,
    score: 'readability',
    gain: readabilityGain(readability, check.id),
    line: line(t, check),
    detail: detail(t, check),
    show: check.at || null,
    ...(check.ai ? { ai: true } : {}),
    ...(againstHandOff(check) ? { handOff: false as const } : {}),
  }));
}

/** Asks for longer sentences or a harder read: the hand-off's checks say shorter and easier. */
const againstHandOff = (check: ReadabilityCheck) =>
  (check.id === 'avgSentence' && check.count < 0) ||
  (check.id === 'readingLevel' && !!check.band && check.count > 0);

/**
 * What would raise the scores, the biggest gain first: Readability's and
 * Trust's suggestions with a gain (E-E-A-T's are the person's to-dos). Hand
 * off fixes these (CE-051).
 */
export function qualitySuggestions(t: T, quality: QualityRead): Suggestion[] {
  return [
    ...readabilitySuggestions(t, quality.readability),
    ...trustSuggestions(t, quality.trust, proofSentences(quality.todos, quality.caseSentences), {
      balanced: quality.aiChecks?.balanced ?? null,
      disclosure: quality.aiChecks?.disclosure ?? null,
      brand: quality.brandName,
    }),
  ]
    .filter((s) => s.gain > 0)
    .sort((a, b) => b.gain - a.gain);
}

/**
 * Hand it off to Content Agent (Quality spec §5, CE-051): one run fixes
 * every suggestion, as suggestions to review; the to-dos stay the person's.
 */
function HandOffCard({ handOff }: { handOff: HandOff }) {
  const t = useTranslations('contentEditor.editor.quality.handOff');
  const whyId = useId();
  const { count, todos, running, blocked, run } = handOff;
  const why = blocked && !running && count > 0 ? blocked : null;
  return (
    <section aria-label={t('title')} className="space-y-2 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium">{t('title')}</h4>
          <p className="text-xs text-muted-foreground">
            {count > 0 ? t('line', { count, todos }) : t('nothing', { todos })}
          </p>
        </div>
        <Button
          size="sm"
          className="h-7 shrink-0"
          disabled={running || count === 0 || !!blocked}
          onClick={run}
          aria-describedby={why ? whyId : undefined}
        >
          {running ? t('running') : t('button')}
        </Button>
      </div>
      {why && (
        <p id={whyId} className="text-xs text-amber-700 dark:text-amber-300">
          {why}
        </p>
      )}
    </section>
  );
}

/** A Trust suggestion: its check, and how many it names (Before you publish's warning). */
export type TrustSuggestion = Suggestion & { check: TrustCheckId; count: number };

/**
 * Trust's: figures without a source, sources past FRESH_MONTHS, links that
 * don't answer, each with Show on the first one in the page. A broken link
 * is listed before Trust is scored too, its gain out of the Phase 1 points.
 * Phase 2 (CE-046): weak or competitors' sources, Show and Keep on the first,
 * and no primary source among them. Phase 2 (CE-047): a price, trial or
 * founding year that differs from the brand's approved facts, listed before
 * Trust is scored too, as a broken link is.
 */
export function trustSuggestions(
  t: T,
  trust: TrustRead | null,
  covered: ReadonlySet<string> = new Set(),
  /**
   * Phase 2 (CE-050): the page read's balance and disclosure, each with the
   * passage Show goes to (where the page puts the brand forward), and the
   * brand's name for their lines.
   */
  page: { balanced: AiCheck | null; disclosure: AiCheck | null; brand: string } | null = null,
): TrustSuggestion[] {
  if (!trust) return [];
  const out: TrustSuggestion[] = [];
  // A sentence a proof to-do asks the person to prove isn't the agent's to
  // source as well (CE-049).
  const unsourced = trust.unsourced.filter((sentence) => !covered.has(sentence));
  if (unsourced.length) {
    // Phase 2 (CE-045): claims the model read count with the figures, so
    // the line says claims; Add source and Remove act on the page's first.
    const claims = trust.aiClaims > 0;
    const first = unsourced[0];
    out.push({
      key: 'trust:claimsSourced',
      check: 'claimsSourced',
      score: 'trust',
      // Each sentence's share: the covered ones' is their to-dos'.
      gain: Math.round(
        (trustGain(trust, ['claimsSourced']) * unsourced.length) / trust.unsourced.length,
      ),
      line: t(claims ? 'checks.claimsSourced.lineClaims' : 'checks.claimsSourced.line', {
        count: unsourced.length,
      }),
      count: unsourced.length,
      detail: t(claims ? 'checks.claimsSourced.detailClaims' : 'checks.claimsSourced.detail'),
      show: first,
      ai: claims,
      claim: trust.marks.find((mark) => mark.sentence === first),
    });
  }
  if (trust.mismatches.length) {
    const [first] = trust.mismatches;
    out.push({
      key: 'trust:brandFacts',
      check: 'brandFacts',
      score: 'trust',
      gain: trustGain(trust, ['brandFacts']),
      line: t('checks.brandFacts.line', {
        kind: first.kind,
        page: first.page,
        source: first.source,
        fact: first.fact,
      }),
      count: trust.mismatches.length,
      detail: t('checks.brandFacts.detail', { count: trust.mismatches.length }),
      show: first.sentence,
    });
  }
  // Phase 3 (CE-053): the person checks which is right, the page or the
  // feed: Hand off leaves it (it isn't one of its keys).
  const feed = trust.feed ?? [];
  if (feed.length) {
    const [first] = feed;
    out.push({
      key: 'trust:feedMatch',
      check: 'feedMatch',
      score: 'trust',
      gain: trustGain(trust, ['feedMatch']),
      line: t('checks.feedMatch.line', {
        kind: first.kind,
        page: first.page,
        feed: first.feed,
      }),
      count: feed.length,
      detail: t('checks.feedMatch.detail', { count: feed.length }),
      show: first.sentence || null,
    });
  }
  if (trust.stale.length) {
    out.push({
      key: 'trust:freshSources',
      check: 'freshSources',
      score: 'trust',
      gain: trustGain(trust, ['freshSources']),
      count: trust.stale.length,
      line: t('checks.freshSources.line', {
        count: trust.stale.length,
        total: trust.dated,
        months: FRESH_MONTHS,
      }),
      detail: t('checks.freshSources.detail'),
      show: trust.stale[0].text,
    });
  }
  // Only once Trust is scored: their gain out of the Phase 1 points would be made up.
  if (trust.weak.length && trust.score !== null) {
    const [first] = trust.weak;
    out.push({
      key: 'trust:noWeakSources',
      check: 'noWeakSources',
      score: 'trust',
      gain: trustGain(trust, ['noWeakSources']),
      line: t('checks.noWeakSources.line', { count: trust.weak.length }),
      count: trust.weak.length,
      detail: t('checks.noWeakSources.detail', {
        host: normalizeDomain(first.url),
        kind: first.kind,
      }),
      show: first.text,
      keep: first.url,
      ai: trust.weak.some((w) => w.ai),
    });
  }
  const primary = trust.checks.find((c) => c.id === 'primarySources');
  if (primary && primary.points < primary.max && trust.score !== null) {
    out.push({
      key: 'trust:primarySources',
      check: 'primarySources',
      score: 'trust',
      gain: trustGain(trust, ['primarySources']),
      line: t('checks.primarySources.line'),
      count: 1,
      detail: t('checks.primarySources.detail'),
      show: null,
    });
  }
  // The page read's (CE-050), once Trust is scored, as the sources' kinds.
  for (const id of ['disclosure', 'balanced'] as const) {
    const read = page?.[id];
    if (!read || read.found || trust.score === null) continue;
    out.push({
      key: `trust:${id}`,
      check: id,
      score: 'trust',
      gain: trustGain(trust, [id]),
      // Before the brand's name is read: "your brand".
      line: t(`checks.${id}.line`, { brand: page!.brand || t('yourBrand') }),
      count: 1,
      detail: t(`checks.${id}.detail`, { brand: page!.brand || t('yourBrand') }),
      show: read.show,
      ai: true,
    });
  }
  if (trust.broken.length) {
    out.push({
      key: 'trust:noBrokenLinks',
      check: 'noBrokenLinks',
      score: 'trust',
      gain: trustGain(trust, ['noBrokenLinks']),
      line: t('checks.noBrokenLinks.line', { count: trust.broken.length }),
      count: trust.broken.length,
      detail: t('checks.noBrokenLinks.detail', {
        count: trust.broken.length,
        url: trust.broken[0].url,
      }),
      show: trust.broken[0].text,
    });
  }
  return out;
}

/** A Readability check's one line: what the draft does now. */
function line(t: T, check: ReadabilityCheck): string {
  switch (check.id) {
    case 'avgSentence':
      return t('checks.avgSentence.line', { words: check.value });
    case 'longSentences':
      return t('checks.longSentences.line', { count: check.count });
    case 'readingLevel':
      return check.formula
        ? t('checks.readingLevel.line', {
            score: check.value,
            formula: t(`formulas.${check.formula}`),
          })
        : t('checks.readingLevel.lineLength');
    case 'answerFirst':
      return t('checks.answerFirst.line');
    case 'shortParagraphs':
      return t('checks.shortParagraphs.line', { count: check.count });
    case 'headingSpacing':
      return t('checks.headingSpacing.line', { count: check.count, words: SECTION_WORDS });
    case 'passiveJargon':
      return t('checks.passiveJargon.line', { passive: check.count, jargon: check.value });
    case 'typeRules':
      return t('checks.typeRules.line', {
        count: check.count,
        names: (check.rules ?? []).map((r) => r.name).join(', '),
      });
  }
}

/** Its detail line: what to do. */
function detail(t: T, check: ReadabilityCheck): string {
  if (check.id === 'avgSentence' && check.count < 0) return t('checks.avgSentence.detailShort');
  if (check.id === 'readingLevel') {
    // English reads by its band (as Site Audit does): over it, the page reads too simple.
    if (check.band) {
      return check.count > 0
        ? t('checks.readingLevel.detailSimple', check.band)
        : t('checks.readingLevel.detailBand', check.band);
    }
    return check.formula
      ? t('checks.readingLevel.detail', { target: check.target ?? 60 })
      : t('checks.readingLevel.detailLength');
  }
  // Each rule with its aim and how the page reads now: what Hand off sends the agent too.
  if (check.id === 'typeRules') {
    return t('checks.typeRules.detail', {
      rules: (check.rules ?? [])
        .map((r) => (r.detail ? `${r.name} (${r.detail})` : r.name))
        .join('; '),
    });
  }
  return t(`checks.${check.id}.detail`);
}

/** The sentences the open proof to-dos ask the person to prove (CE-049), and its customer cases'. */
export function proofSentences(
  todos: readonly QualityTodo[],
  /** Phase 3 (CE-052): the page's customer cases' sentences, confirmed or not: the person's. */
  cases: readonly string[] = [],
): ReadonlySet<string> {
  return new Set([
    ...todos.flatMap((todo) => (todo.proof && !todo.done ? [todo.proof.sentence] : [])),
    ...cases,
  ]);
}
