'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Minus,
  Sparkles,
  Copy,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AuditResult, AuditSignal, AuditRecommendation } from '@/lib/actions/audits';
import {
  firstPersonEvidence,
  languageName,
  readingEvidence,
  type ReadingEvidence,
} from '@/lib/audit/readingEvidence';
import { AUTHORITY_SIGNAL, AuthoritySources } from './AuthoritySources';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';

// Display order + labels for the five rubric categories (keys come from the
// server's categoryScores). Mirrors the rubric category weights.
export const CATEGORY_META: { key: string; label: string; weight: number }[] = [
  { key: 'structure', label: 'Structure', weight: 0.25 },
  { key: 'content', label: 'Content', weight: 0.25 },
  { key: 'authority', label: 'Authority', weight: 0.2 },
  { key: 'eeat', label: 'E-E-A-T', weight: 0.2 },
  { key: 'trust', label: 'Trust', weight: 0.1 },
];

export function pct(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100);
}

export function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 0.7) return 'text-green-600';
  if (score >= 0.4) return 'text-amber-500';
  return 'text-destructive';
}

export function barColor(score: number | null): string {
  if (score === null) return 'bg-muted';
  if (score >= 0.7) return 'bg-green-600';
  if (score >= 0.4) return 'bg-amber-500';
  return 'bg-destructive';
}

const STATUS_ICON = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  na: Minus,
} as const;

const STATUS_COLOR = {
  pass: 'text-green-600',
  warn: 'text-amber-500',
  fail: 'text-destructive',
  na: 'text-muted-foreground',
} as const;

function gradeKey(score: number | null): 'good' | 'needsWork' | 'poor' | null {
  if (score === null) return null;
  if (score >= 0.7) return 'good';
  if (score >= 0.4) return 'needsWork';
  return 'poor';
}

export function ScoreGauge({ score }: { score: number | null }) {
  const p = pct(score) ?? 0;
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dash = (p / 100) * circ;
  const stroke =
    score === null
      ? 'stroke-muted-foreground'
      : score >= 0.7
        ? 'stroke-green-600'
        : score >= 0.4
          ? 'stroke-amber-500'
          : 'stroke-destructive';
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={cn('transition-all duration-700', stroke)}
          strokeDasharray={`${dash} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-4xl font-bold tabular-nums', scoreColor(score))}>
          {pct(score) ?? '—'}
        </span>
        <span className="text-[11px] text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

// A value only the brand knows, for the user to fill in ("Your input
// needed"), e.g. "[customer name]" or "[your price]". The guard takes out a
// figure the page doesn't have: none is left to research.
const PLACEHOLDER = /(\[[A-Za-z][A-Za-z ]{1,38}\])/;

function hasPlaceholder(text: string | null | undefined): boolean {
  return !!text && PLACEHOLDER.test(text);
}

function DraftBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  const t = useTranslations('audit');
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(t('copied')),
      () => toast.error(t('copyFailed')),
    );
  };
  return (
    <div className="relative rounded-md border bg-muted/50 p-3">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-7 w-7"
        onClick={copy}
        aria-label={copyLabel}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <pre className="whitespace-pre-wrap pr-8 text-xs leading-relaxed text-foreground">
        {text.split(PLACEHOLDER).map((part, i) =>
          i % 2 === 1 ? (
            <mark
              key={i}
              title={t('inputNeeded')}
              className="rounded bg-amber-100 px-0.5 font-medium text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
            >
              {part}
            </mark>
          ) : (
            part
          ),
        )}
      </pre>
    </div>
  );
}

/** The draft and code to paste, with a reminder when they hold placeholders. */
function PasteBlocks({ rec }: { rec: AuditRecommendation }) {
  const t = useTranslations('audit');
  if (!rec.draft && !rec.code) return null;
  return (
    <>
      {rec.draft && <DraftBlock text={rec.draft} copyLabel={t('copyDraft')} />}
      {rec.code && <DraftBlock text={rec.code} copyLabel={t('copyCode')} />}
      {(hasPlaceholder(rec.draft) || hasPlaceholder(rec.code)) && (
        <p className="text-xs text-muted-foreground">{t('placeholderNote')}</p>
      )}
    </>
  );
}

/** Readability's finding in parts: its score by the language's formula, then sentences, words and paragraphs. */
function ReadingFinding({ evidence }: { evidence: ReadingEvidence }) {
  const t = useTranslations('audit');
  const tFormula = useTranslations('contentEditor.editor.quality.formulas');
  const language = languageName(evidence.language);
  return (
    <div>
      <p>
        <span className="font-medium text-foreground">{t('finding')}: </span>
        {evidence.formula && evidence.readingScore !== null
          ? t('evidence.reading', {
              score: evidence.readingScore,
              formula: tFormula(evidence.formula),
              language,
            })
          : t('evidence.readingNoFormula', { language })}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>{t('evidence.sentences', { words: evidence.wordsPerSentence })}</li>
        <li>
          {evidence.syllablesPerWord !== null
            ? t('evidence.words', {
                syllables: evidence.syllablesPerWord,
                letters: evidence.lettersPerWord,
              })
            : t('evidence.wordsLetters', { letters: evidence.lettersPerWord })}
        </li>
        {evidence.wordsPerParagraph !== null && evidence.mobileLinesPerParagraph !== null && (
          <li>
            {t('evidence.paragraphs', {
              words: evidence.wordsPerParagraph,
              lines: evidence.mobileLinesPerParagraph,
            })}
          </li>
        )}
      </ul>
    </div>
  );
}

/** What a check found, from its evidence: its reason, or readability's and first person's counts. */
function Finding({ signal }: { signal: AuditSignal }) {
  const t = useTranslations('audit');
  const evidence = signal.evidence ?? {};
  if (typeof evidence.reason === 'string' && evidence.reason) {
    return (
      <p>
        <span className="font-medium text-foreground">{t('finding')}: </span>
        {evidence.reason}
      </p>
    );
  }
  const reading = signal.key === 'readability' ? readingEvidence(evidence) : null;
  if (reading) return <ReadingFinding evidence={reading} />;
  const told = signal.key === 'first-person' ? firstPersonEvidence(evidence) : null;
  if (told) {
    return (
      <p>
        <span className="font-medium text-foreground">{t('finding')}: </span>
        {t('evidence.firstPerson', {
          count: told.firstPersonSentences,
          total: told.sentences,
          language: languageName(told.language),
        })}
      </p>
    );
  }
  return null;
}

function SignalRow({
  signal,
  recommendation,
}: {
  signal: AuditSignal;
  recommendation?: AuditRecommendation;
}) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[signal.status] ?? Minus;
  const t = useTranslations('audit');

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40"
        aria-expanded={open}
        aria-controls={`signal-panel-${signal.key}`}
      >
        <Icon className={cn('h-4 w-4 shrink-0', STATUS_COLOR[signal.status])} />
        <span className="flex-1 text-sm font-medium">{signal.label}</span>
        {signal.impactTier && (
          <Badge
            variant={signal.impactTier === 'high' ? 'default' : 'secondary'}
            className="text-[10px]"
          >
            {signal.impactTier}
          </Badge>
        )}
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          id={`signal-panel-${signal.key}`}
          className="space-y-2 pb-4 pl-7 text-sm text-muted-foreground"
        >
          <Finding signal={signal} />
          {signal.key === AUTHORITY_SIGNAL ? (
            <AuthoritySources signal={signal} />
          ) : (
            signal.what && <p>{signal.what}</p>
          )}
          {signal.why && (
            <p>
              <span className="font-medium text-foreground">{t('why')}: </span>
              {signal.why}
            </p>
          )}
          {/* Prefer the page-specific AI recommendation when we have one; fall
              back to the rubric's generic fix otherwise. */}
          {recommendation ? (
            <div className="space-y-2">
              <p>
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> {t('recommendedFix')}:
                </span>{' '}
                {recommendation.recommendation}
              </p>
              <PasteBlocks rec={recommendation} />
            </div>
          ) : (
            signal.status !== 'pass' &&
            signal.howToFix && (
              <p>
                <span className="font-medium text-foreground">{t('fix')}: </span>
                {signal.howToFix}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function RecommendationItem({ rec }: { rec: AuditRecommendation }) {
  return (
    <div className="space-y-2 border-b py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <Badge variant={rec.priority === 'high' ? 'default' : 'secondary'} className="text-[10px]">
          {rec.priority}
        </Badge>
        <span className="text-sm font-medium">{rec.label}</span>
      </div>
      <p className="text-sm text-muted-foreground">{rec.recommendation}</p>
      <PasteBlocks rec={rec} />
    </div>
  );
}

export function AuditReport({ audit }: { audit: AuditResult }) {
  const t = useTranslations('audit');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const recBySignal = new Map(audit.recommendations.map((r) => [r.signalKey, r]));

  const counts = audit.signals.reduce(
    (acc, s) => {
      if (s.status === 'pass') acc.pass += 1;
      else if (s.status === 'warn') acc.warn += 1;
      else if (s.status === 'fail') acc.fail += 1;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
  const hasIssues = counts.fail + counts.warn > 0;
  const grade = gradeKey(audit.totalScore);
  const scoreDelta =
    audit.totalScore !== null && audit.previousScore != null
      ? Math.round(audit.totalScore * 100) - Math.round(audit.previousScore * 100)
      : null;
  const previousDate =
    audit.previousCreatedAt && Number.isFinite(Date.parse(audit.previousCreatedAt))
      ? formatMonthDay(audit.previousCreatedAt)
      : null;

  const visibleSignals = (cat: string) =>
    audit.signals.filter(
      (s) => s.category === cat && (!onlyIssues || s.status === 'fail' || s.status === 'warn'),
    );

  return (
    <div className="space-y-6">
      {/* Headline: gauge + grade + pass/warn/fail summary */}
      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-6 sm:flex-row sm:items-center">
          <ScoreGauge score={audit.totalScore} />
          <div className="flex-1 space-y-2 text-center sm:text-left">
            <div className="text-sm font-medium break-all">{audit.finalUrl || audit.url}</div>
            {grade && (
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <div className={cn('text-lg font-semibold', scoreColor(audit.totalScore))}>
                  {t(`grade.${grade}`)}
                </div>
                {scoreDelta !== null && previousDate && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-medium tabular-nums',
                      scoreDelta > 0 &&
                        'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400',
                      scoreDelta < 0 && 'border-destructive/30 bg-destructive/10 text-destructive',
                      scoreDelta === 0 && 'text-muted-foreground',
                    )}
                  >
                    {t('scoreChange', {
                      change: scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta),
                      date: previousDate,
                    })}
                  </Badge>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> {counts.pass} {t('summary.passed')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {counts.warn} {t('summary.warnings')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                <XCircle className="h-3.5 w-3.5" /> {counts.fail} {t('summary.failed')}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {audit.signalsEvaluated}/{audit.signalsTotal} {t('signalsEvaluated')}
            </div>
            {audit.partial && (
              <p className="flex items-start justify-center gap-1.5 text-xs text-amber-700 sm:justify-start dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t('partialNote')}
                  <span className="block">{t('partialNoCredit')}</span>
                </span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI fix recommendations */}
      {audit.recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('aiRecommendations')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {[...audit.recommendations]
              .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
              .map((rec, i) => (
                <RecommendationItem key={`${rec.signalKey}-${i}`} rec={rec} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Category breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('categoryBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {CATEGORY_META.map((cat) => {
            const cs = audit.categoryScores[cat.key];
            const score = cs?.score ?? null;
            const p = pct(score);
            return (
              <div key={cat.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{cat.label}</span>
                  <span className="text-muted-foreground">
                    {p === null ? 'n/a' : `${p}/100`}
                    {cs ? ` · ${cs.evaluated}/${cs.total}` : ''}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all', barColor(score))}
                    style={{ width: `${p ?? 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Signals header + issues-only filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('signals')}</h2>
        <Button variant="outline" size="sm" onClick={() => setOnlyIssues((v) => !v)}>
          {onlyIssues ? t('allSignals') : t('onlyIssues')}
        </Button>
      </div>

      {onlyIssues && !hasIssues ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t('noIssues')}
          </CardContent>
        </Card>
      ) : (
        CATEGORY_META.map((cat) => {
          const sigs = visibleSignals(cat.key);
          if (sigs.length === 0) return null;
          return (
            <Card key={cat.key}>
              <CardHeader>
                <CardTitle className="text-base">{cat.label}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {sigs.map((s) => (
                  <SignalRow key={s.key} signal={s} recommendation={recBySignal.get(s.key)} />
                ))}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
