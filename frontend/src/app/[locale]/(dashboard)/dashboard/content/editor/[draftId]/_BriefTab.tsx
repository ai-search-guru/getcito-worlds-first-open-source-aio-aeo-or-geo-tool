'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { saveDraftBrief } from '@/lib/actions/contentDrafts';
import type { InputsGiven } from '@/lib/content/draftInputs';
import {
  BRIEF_V2_LIMITS,
  MAX_BRIEF_SECTIONS,
  PROOF_KINDS,
  builtFromCount,
  type DraftBrief,
  type ProofKind,
} from '@/lib/content/brief';
import type { DraftMethod } from '@/lib/content/drafts';
import { platformNames } from '@/lib/content/impact';
import { pagePath } from '@/lib/content/overlap';
import { wordsForLength } from '@/lib/content/rules';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RunCard } from './_RunCard';
import { WorkingDots } from './_WorkingDots';

/**
 * Rewrite from brief: the Content Agent writes the page again from the brief
 * (a new page), or suggests changes from it (a live page), as Start's agent
 * does (contentWriter.js).
 */
export interface AgentRewrite {
  run: () => void;
  running: boolean;
  /** Why it can't run now (open suggestions to decide first), or null. */
  blocked: string | null;
}

/** The brief as the panel holds it: read once the tab opens. */
export type BriefState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; brief: DraftBrief | null };

/** The input a kind of proof is given as: a case or a test is the person's experience. */
const PROOF_INPUT: Record<ProofKind, keyof InputsGiven> = {
  experience: 'experience',
  case: 'experience',
  test: 'experience',
  data: 'data',
  quote: 'quote',
};

/**
 * The Brief segment (Content Editor CE-007, spec §10; v1.1 CE-030): a card
 * saying whether there is a brief, with Run Agent to write it from the
 * sources kept (Rebuild brief once there is one), then the page type and
 * target address, the goal, audience and length (in characters, and about
 * as many words), and the outline with each H2's fan-out and platform. Edit
 * brief changes it by hand. Until the draft has a brief, the opportunity's
 * brief it started from is shown. Rewrite from brief hands the page to the
 * Content Agent with it.
 *
 * A brief of version 2 (the brief rules, 2026) shows its plan too: the
 * TL;DR and angle, each section's answer, format and facts, the brand's own
 * proof to gather (marked when Your input has it), and, folded, the writing
 * notes: names as written, links, freshness and the fan-outs left for
 * another page.
 */
export function BriefTab({
  draftId,
  state,
  pageType,
  length,
  sourceUrl,
  method,
  rebuilding,
  onRebuild,
  onRetry,
  onSaved,
  rewrite,
  dataLine,
  blocked = null,
  given = null,
  onAddInput,
}: {
  draftId: string;
  state: BriefState;
  pageType: string | null;
  /** The length the rules ask for (CE-009). */
  length: number;
  sourceUrl: string | null;
  method: DraftMethod;
  rebuilding: boolean;
  onRebuild: () => void;
  onRetry: () => void;
  onSaved: (brief: DraftBrief) => void;
  /** Absent once the page is ready or published. */
  rewrite?: AgentRewrite;
  /** "Uses your data", under Run Agent's card (v1.1 CE-032). */
  dataLine?: React.ReactNode;
  /** Why Run Agent waits (another agent run from the page), or null. */
  blocked?: string | null;
  /** What Your input has, once read (draftInputs.ts inputsGiven): proof it has is marked. */
  given?: InputsGiven | null;
  /** Opens Brief › Your input, for a proof to gather. */
  onAddInput?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.brief');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const [editing, setEditing] = useState(false);
  // A brief edited by hand is rebuilt only once the person says so.
  const [confirming, setConfirming] = useState(false);
  // The agent writes over the page (or suggests changes) only once the person says so.
  const [confirmingRewrite, setConfirmingRewrite] = useState(false);
  // A read-only workspace (plan not active): Run Agent, Rebuild, the rewrite
  // and Edit open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  if (state.status === 'loading') {
    return (
      <div className="flex justify-center py-8" aria-busy="true">
        <LoadingDots className="text-muted-foreground" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {t('loadError')}
        <button type="button" className="font-medium underline" onClick={onRetry}>
          {t('retry')}
        </button>
      </p>
    );
  }

  const brief = state.brief;
  if (editing) {
    return (
      <BriefEditor
        draftId={draftId}
        brief={brief ?? EMPTY_BRIEF}
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          onSaved(saved);
        }}
      />
    );
  }

  const typeLabel = pageType && (tTypes.has(pageType) ? tTypes(pageType) : pageType);
  // Nothing written yet: Run Agent writes it. Once it is, Rebuild brief.
  const empty = !brief || (!brief.goal && !brief.audience && brief.outline.length === 0);
  const rebuild = guard(
    () => (brief?.origin === 'edit' && !empty ? setConfirming(true) : onRebuild()),
    { action: tActions('buildBrief') },
  );

  return (
    <div className="space-y-4 text-sm">
      <RunCard
        title={empty ? t('status.empty') : t('status.ready', { count: brief?.outline.length ?? 0 })}
        detail={empty ? t('status.emptyDetail') : undefined}
        action={
          <Button
            size="sm"
            variant={empty ? 'default' : 'outline'}
            className="shrink-0"
            disabled={rebuilding || confirming || blocked !== null}
            onClick={rebuild}
          >
            {rebuilding && <WorkingDots className="ml-0" />}
            {empty ? t('run') : t('rebuild')}
          </Button>
        }
        info={t('info')}
        data={dataLine}
        blocked={rebuilding ? null : blocked}
      >
        <p className="text-[11px] text-muted-foreground">{t('usage')}</p>
        {/* Under the card that asked, not past the outline. */}
        {confirming && (
          <div role="alert" className="space-y-2 rounded-md border px-3 py-2 text-xs">
            <p>{t('rebuildEdited')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                  onRebuild();
                }}
              >
                {t('rebuildAnyway')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t('keepEdited')}
              </Button>
            </div>
          </div>
        )}
      </RunCard>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">{t('pageType')}</dt>
        <dd className={cn(!typeLabel && 'text-muted-foreground')}>{typeLabel || t('notSet')}</dd>
        <dt className="text-muted-foreground">{t('targetUrl')}</dt>
        <dd className="min-w-0 truncate" title={sourceUrl ?? undefined}>
          {sourceUrl ? pagePath(sourceUrl) : t('newPage')}
        </dd>
        <dt className="text-muted-foreground">{t('goal')}</dt>
        <dd className={cn(!brief?.goal && 'text-muted-foreground')}>
          {brief?.goal || t('notSet')}
        </dd>
        <dt className="text-muted-foreground">{t('audience')}</dt>
        <dd className={cn(!brief?.audience && 'text-muted-foreground')}>
          {brief?.audience || t('notSet')}
        </dd>
        {brief?.tldr && (
          <>
            <dt className="text-muted-foreground">{t('tldr')}</dt>
            <dd>{brief.tldr}</dd>
          </>
        )}
        {brief?.angle && (
          <>
            <dt className="text-muted-foreground">{t('angle')}</dt>
            <dd>{brief.angle}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('length')}</dt>
        <dd>
          {t('lengthValue', {
            count: formatNumber(length),
            words: formatNumber(wordsForLength(length)),
          })}
          <span className="block text-muted-foreground">
            {brief?.citedLength
              ? t('lengthFromCited', {
                  count: formatNumber(brief.citedLength.characters),
                  pages: brief.citedLength.pages,
                })
              : t('lengthFrom')}
          </span>
        </dd>
        {/* What the cited pages have (learning C2), read with their length. */}
        {brief?.citedFeatures && brief.citedFeatures.checks.length > 0 && (
          <>
            <dt className="text-muted-foreground">{t('citedHave')}</dt>
            <dd>
              {brief.citedFeatures.checks
                .map((check) =>
                  t('citedHaveCheck', {
                    check: check.label,
                    count: check.pages,
                    of: brief.citedFeatures!.pages,
                  }),
                )
                .join(' · ')}
              <span className="block text-muted-foreground">{t('citedHaveFrom')}</span>
            </dd>
          </>
        )}
      </dl>

      {brief && brief.outline.length > 0 ? (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('outline')}{' '}
            <span className="font-normal">· {formatNumber(brief.outline.length)}</span>
          </h4>
          <ol className="space-y-1.5">
            {brief.outline.map((section, i) => (
              <li key={i} className="rounded-lg border px-3 py-2">
                <p className="flex items-start gap-1.5 text-xs font-medium">
                  <span className="text-muted-foreground">H2</span>
                  <span className="min-w-0 flex-1">{section.heading}</span>
                  {section.format && (
                    <span className="shrink-0 rounded-md border px-1.5 text-[10.5px] font-normal text-muted-foreground">
                      {t(`formats.${section.format}`)}
                    </span>
                  )}
                </p>
                {section.answer && (
                  <p className="mt-1 text-xs">{t('answerFirst', { answer: section.answer })}</p>
                )}
                {section.keyPoints.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {section.keyPoints.map((point, j) => (
                      <li key={j}>{point}</li>
                    ))}
                  </ul>
                )}
                {(section.facts ?? []).length > 0 && (
                  <ul className="mt-1.5 space-y-1 text-[11px]">
                    {(section.facts ?? []).map((fact, j) => (
                      <li key={j} className="min-w-0">
                        <span className="break-words">
                          {t('fact', {
                            kind: t(`factSources.${fact.sourceType}`),
                            claim: fact.claim,
                          })}
                        </span>
                        <span
                          className="block truncate text-muted-foreground"
                          title={fact.source?.label}
                        >
                          {fact.source
                            ? t('factFrom', { source: fact.source.label })
                            : t('factToFind')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.fanout && (
                  <p className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                    <span className="truncate" title={section.fanout}>
                      {t('answers', { fanout: section.fanout })}
                    </span>
                    {section.platform && (
                      <span className="shrink-0 text-muted-foreground">
                        · {platformNames([section.platform])[0]}
                      </span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {empty ? t('empty') : t('emptyOutline')}
        </p>
      )}

      {brief?.proof && brief.proof.length > 0 && (
        <ProofList proof={brief.proof} given={given} onAddInput={onAddInput} />
      )}

      {brief && brief.keywords.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">{t('keywords')}</h4>
          <div className="flex flex-wrap gap-1">
            {brief.keywords.map((keyword) => (
              <span key={keyword} className="rounded-md border px-1.5 py-0.5 text-[11px]">
                {keyword}
              </span>
            ))}
          </div>
        </section>
      )}

      {brief && <WritingNotes brief={brief} />}

      {brief && !empty && (
        <p className="text-[11px] text-muted-foreground">
          {brief.origin === 'opportunity'
            ? t('fromOpportunity')
            : brief.origin === 'edit'
              ? t('edited')
              : t('builtFrom', {
                  count: builtFromCount(brief),
                  date: brief.builtAt ? formatDateTime(brief.builtAt) : '',
                })}
        </p>
      )}

      {rewrite &&
        brief &&
        brief.outline.length > 0 &&
        (confirmingRewrite ? (
          <div role="alert" className="space-y-2 rounded-md border px-3 py-2 text-xs">
            <p>{t(`rewrite.confirm.${method}`)}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmingRewrite(false);
                  rewrite.run();
                }}
              >
                {t('rewrite.start')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingRewrite(false)}>
                {t('rewrite.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="w-full"
              disabled={rewrite.running || rewrite.blocked !== null || rebuilding}
              onClick={guard(() => setConfirmingRewrite(true), { action: tActions('runAgent') })}
            >
              {rewrite.running ? <WorkingDots className="ml-0" /> : <Bot className="h-3.5 w-3.5" />}
              {t(`rewrite.button.${method}`)}
            </Button>
            {/* Why it waits, written out (v1.1 CE-031), not only on hover. */}
            {!rewrite.running && rewrite.blocked && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{rewrite.blocked}</p>
            )}
          </div>
        ))}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={rebuilding}
          onClick={guard(() => setEditing(true), { action: tActions('editBrief') })}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t('edit')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The brand's own proof to gather, each with its kind: marked when Brief ›
 * Your input has that kind, else Add input opens it.
 */
function ProofList({
  proof,
  given,
  onAddInput,
}: {
  proof: NonNullable<DraftBrief['proof']>;
  given: InputsGiven | null;
  onAddInput?: () => void;
}) {
  const t = useTranslations('contentEditor.editor.brief.proof');
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{t('title')}</h4>
      <p className="text-[11px] text-muted-foreground">{t('info')}</p>
      <ul className="space-y-1.5">
        {proof.map((item, i) => {
          const have = given?.[PROOF_INPUT[item.kind]] === true;
          return (
            <li key={i} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
              <span className="shrink-0 rounded-md bg-muted px-1.5 text-[10.5px]">
                {t(`kinds.${item.kind}`)}
              </span>
              <span className="min-w-0 flex-1 break-words">{item.what}</span>
              {have ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                  <Check className="h-3 w-3" aria-hidden />
                  {t('have')}
                </span>
              ) : (
                onAddInput &&
                given && (
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-medium underline"
                    // Each row's own name: "Add input" alone says nothing out of context.
                    aria-label={t('addFor', { what: item.what })}
                    onClick={onAddInput}
                  >
                    {t('add')}
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The writing notes of version 2, folded until opened: names as written,
 * the links planned, freshness and the fan-outs left for another page. The
 * writer reads them; they aren't edited here.
 */
function WritingNotes({ brief }: { brief: DraftBrief }) {
  const t = useTranslations('contentEditor.editor.brief.notes');
  const [open, setOpen] = useState(false);
  const id = useId();
  const names = brief.entities;
  const links = [
    ...(brief.links?.internal ?? []).map((link) => ({ ...link, kind: 'internal' as const })),
    ...(brief.links?.outbound ?? []).map((link) => ({ ...link, kind: 'outbound' as const })),
  ];
  const fresh = brief.freshness;
  const leftOut = brief.leftOut ?? [];
  const hasNames =
    !!names && (!!names.brand || names.products.length + names.competitors.length > 0);
  if (!hasNames && !links.length && !fresh && !leftOut.length) return null;
  const muted = (chunks: React.ReactNode) => (
    <span className="text-muted-foreground">{chunks}</span>
  );
  return (
    <section className="overflow-hidden rounded-lg border">
      <h4 className="text-xs font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
        >
          {t('title')}
          <ChevronDown
            aria-hidden
            className={cn('ml-auto h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </h4>
      {/* Kept in the page, hidden while folded, so aria-controls names it. */}
      <dl id={id} hidden={!open} className="space-y-2 border-t px-3 py-2 text-xs">
        {hasNames && names && (
          <div>
            <dt className="text-muted-foreground">{t('names')}</dt>
            <dd className="space-y-0.5 break-words">
              {names.brand && <p>{t('brand', { name: names.brand })}</p>}
              {names.products.length > 0 && (
                <p>{t('products', { names: names.products.join(', ') })}</p>
              )}
              {names.competitors.length > 0 && (
                <p>{t('competitors', { names: names.competitors.join(', ') })}</p>
              )}
            </dd>
          </div>
        )}
        {links.length > 0 && (
          <div>
            <dt className="text-muted-foreground">{t('links')}</dt>
            <dd>
              <ul className="space-y-0.5">
                {links.map((link, i) => (
                  <li key={i} className="min-w-0 break-words" title={link.url}>
                    {t.rich('link', {
                      kind: t(link.kind),
                      anchor: link.anchor,
                      // An outbound link names its site; the brand's own, its page.
                      page: link.kind === 'outbound' ? sitePage(link.url) : pagePath(link.url),
                      where: link.section
                        ? t('inSection', { section: link.section })
                        : t('anywhere'),
                      muted,
                    })}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {fresh && (
          <div>
            <dt className="text-muted-foreground">{t('freshness')}</dt>
            <dd className="space-y-0.5 break-words">
              {fresh.datedPoint && <p>{t('datedPoint', { point: fresh.datedPoint })}</p>}
              {fresh.updatedLine && <p>{t('updatedLine')}</p>}
              {fresh.yearInTitle && <p>{t('yearInTitle')}</p>}
            </dd>
          </div>
        )}
        {leftOut.length > 0 && (
          <div>
            <dt className="text-muted-foreground">{t('leftOut')}</dt>
            <dd>
              <ul className="list-disc pl-4 break-words">
                {leftOut.map((query, i) => (
                  <li key={i}>{query}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** A page on another site, as a writer tells it apart: its host and path. */
function sitePage(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

/** What Edit brief starts from when the draft has no brief: H2s added by hand. */
const EMPTY_BRIEF: DraftBrief = {
  goal: '',
  audience: '',
  outline: [],
  keywords: [],
  origin: 'edit',
  builtAt: null,
  builtFrom: null,
};

/** Edit brief: goal, audience, the outline's sections and key points, keywords. */
function BriefEditor({
  draftId,
  brief,
  onCancel,
  onSaved,
}: {
  draftId: string;
  brief: DraftBrief;
  onCancel: () => void;
  onSaved: (brief: DraftBrief) => void;
}) {
  const t = useTranslations('contentEditor.editor.brief.editor');
  const [goal, setGoal] = useState(brief.goal);
  const [audience, setAudience] = useState(brief.audience);
  const [sections, setSections] = useState(
    brief.outline.map((s) => ({ ...s, points: s.keyPoints.join('\n') })),
  );
  const [keywords, setKeywords] = useState(brief.keywords.join(', '));
  // Version 2's plan, edited as the rest; a brief before it gets none added.
  // Read once, when Edit opens: a rebuild landing meanwhile doesn't change the form.
  const [v2] = useState(brief.version === 2);
  const [tldr, setTldr] = useState(brief.tldr ?? '');
  const [angle, setAngle] = useState(brief.angle ?? '');
  const [proof, setProof] = useState(brief.proof ?? []);
  const [saving, setSaving] = useState(false);

  const update = (index: number, change: Partial<(typeof sections)[number]>) =>
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveDraftBrief(draftId, {
        ...brief,
        goal: goal.trim(),
        audience: audience.trim(),
        ...(v2
          ? {
              tldr: tldr.trim() || null,
              angle: angle.trim() || null,
              proof: proof
                .map((p) => ({ ...p, what: p.what.trim() }))
                .filter((p) => p.what)
                .slice(0, BRIEF_V2_LIMITS.proof),
            }
          : {}),
        // What Edit brief doesn't show (version 2's format, facts) is kept.
        outline: sections
          .filter((s) => s.heading.trim())
          .map(({ points, ...s }) => ({
            ...s,
            heading: s.heading.trim(),
            keyPoints: points
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean),
            ...(v2 ? { answer: s.answer?.trim() || null } : {}),
          })),
        keywords: [
          ...new Set(
            keywords
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          ),
        ],
      });
      toast.success(t('saved'));
      onSaved(saved);
    } catch (err) {
      console.error('Failed to save the brief:', err);
      toast.error(t(err instanceof Error && err.message === 'too_long' ? 'tooLong' : 'failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('goal')}</span>
        <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={500} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('audience')}</span>
        <Input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={500} />
      </label>
      {v2 && (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('tldr')}</span>
            <Textarea
              value={tldr}
              onChange={(e) => setTldr(e.target.value)}
              rows={2}
              maxLength={BRIEF_V2_LIMITS.tldr}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('angle')}</span>
            <Textarea
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              rows={2}
              maxLength={BRIEF_V2_LIMITS.angle}
            />
          </label>
        </>
      )}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">{t('outline')}</span>
        {sections.map((section, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">H2</span>
              <Input
                value={section.heading}
                onChange={(e) => update(i, { heading: e.target.value })}
                aria-label={t('heading', { index: i + 1 })}
                maxLength={300}
                className="h-8"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('remove', { index: i + 1 })}
                onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {v2 && (
              <div className="space-y-1">
                {/* Named on screen: once filled, its placeholder is gone. */}
                <span className="text-[11px] text-muted-foreground">{t('answerLabel')}</span>
                <Textarea
                  value={section.answer ?? ''}
                  onChange={(e) => update(i, { answer: e.target.value })}
                  aria-label={t('answer', { index: i + 1 })}
                  placeholder={t('answerPlaceholder')}
                  rows={2}
                  maxLength={BRIEF_V2_LIMITS.answer}
                  className="text-xs"
                />
              </div>
            )}
            <Textarea
              value={section.points}
              onChange={(e) => update(i, { points: e.target.value })}
              aria-label={t('points', { index: i + 1 })}
              placeholder={t('pointsPlaceholder')}
              rows={2}
              className="text-xs"
            />
          </div>
        ))}
        {sections.length < MAX_BRIEF_SECTIONS && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSections((prev) => [
                ...prev,
                { heading: '', keyPoints: [], points: '', fanout: null, platform: null },
              ])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addSection')}
          </Button>
        )}
      </div>
      {v2 && <ProofEditor proof={proof} onChange={setProof} />}
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('keywords')}</span>
        <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving && <LoadingDots />}
          {t('save')}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Edit brief's proof to gather: each with its kind, up to the web's limit. */
function ProofEditor({
  proof,
  onChange,
}: {
  proof: NonNullable<DraftBrief['proof']>;
  onChange: (proof: NonNullable<DraftBrief['proof']>) => void;
}) {
  const t = useTranslations('contentEditor.editor.brief');
  const items = PROOF_KINDS.map((kind) => ({ value: kind, label: t(`proof.kinds.${kind}`) }));
  const set = (index: number, change: Partial<(typeof proof)[number]>) =>
    onChange(proof.map((p, i) => (i === index ? { ...p, ...change } : p)));
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{t('editor.proof')}</span>
      {proof.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Select
            items={items}
            value={item.kind}
            onValueChange={(value) => {
              if ((PROOF_KINDS as readonly string[]).includes(String(value))) {
                set(i, { kind: value as ProofKind });
              }
            }}
          >
            <SelectTrigger
              aria-label={t('editor.proofKind', { index: i + 1 })}
              className="h-8 w-28"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={item.what}
            onChange={(e) => set(i, { what: e.target.value })}
            aria-label={t('editor.proofWhat', { index: i + 1 })}
            maxLength={BRIEF_V2_LIMITS.proofWhat}
            className="h-8"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('editor.removeProof', { index: i + 1 })}
            onClick={() => onChange(proof.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {proof.length < BRIEF_V2_LIMITS.proof && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...proof, { kind: 'experience', what: '' }])}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('editor.addProof')}
        </Button>
      )}
    </div>
  );
}
