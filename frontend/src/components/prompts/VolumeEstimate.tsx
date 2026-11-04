'use client';

import { useTranslations } from 'next-intl';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  createTooltipHandle,
} from '@/components/ui/tooltip';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatEstimateRange, type EstimateTotal, type VolumeEstimate } from '@/lib/volumeEstimate';

/** One prompt's estimate, a sum of prompts', or their average per prompt. */
export type EstimateKind = 'prompt' | 'total' | 'average';

type Estimate = VolumeEstimate | EstimateTotal;

const isTotal = (estimate: Estimate): estimate is EstimateTotal => 'count' in estimate;

/** "Oct 2026": the month the Google volumes are from. */
function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The confidence line's wording for each dated basis: when the estimate is from. */
const CONFIDENCE_KEY = {
  keywords: 'confidence',
  keyword: 'confidence',
  guess: 'confidenceSuggested',
} as const;

/** What low confidence means for each basis. */
const LOW_NOTE_KEY = {
  keywords: 'lowNote',
  keyword: 'lowNote',
  guess: 'lowNoteGuess',
  snapshot: 'lowNoteSnapshot',
} as const;

/** How the estimate is built, from what, how sure it is and since when (PROMPT-013). */
function EstimateNote({ estimate, kind }: { estimate: Estimate; kind: EstimateKind }) {
  const t = useTranslations('volumeEstimate');
  const rate = Math.round(estimate.rate * 100);
  const level = t(`level.${estimate.confidence}`);
  return (
    <>
      <p className="font-medium">{t('title')}</p>
      {estimate.basis === 'snapshot' ? (
        <p>{t('methodSnapshot')}</p>
      ) : estimate.basis === 'guess' ? (
        <p>{t(kind === 'total' ? 'methodGuessTotal' : 'methodGuess')}</p>
      ) : estimate.basis === 'keyword' ? (
        <p>{t('methodKeyword', { rate })}</p>
      ) : kind === 'prompt' || !isTotal(estimate) ? (
        <>
          <p>{t('method', { rate })}</p>
          <p>
            {estimate.measured === 0
              ? t('noKeywords')
              : t('keywords', { measured: estimate.measured, keywords: estimate.keywords })}{' '}
            {estimate.measured >= 2 ? t('rangeSpread') : estimate.measured === 1 && t('rangeOne')}
          </p>
        </>
      ) : (
        <>
          <p>
            {t(kind === 'average' ? 'methodAverage' : 'methodTotal', {
              count: estimate.count,
              rate,
            })}
          </p>
          <p>
            {t('mix', {
              high: estimate.byConfidence.high,
              medium: estimate.byConfidence.medium,
              low: estimate.byConfidence.low,
            })}
          </p>
        </>
      )}
      <p>
        {estimate.basis === 'snapshot'
          ? t('sourcesSnapshot')
          : estimate.basis === 'guess'
            ? t('sourcesGuess')
            : estimate.asOf
              ? t('sources', { month: monthOf(estimate.asOf), rate })
              : t('sourcesUndated', { rate })}
      </p>
      <p>
        {estimate.asOf && estimate.basis !== 'snapshot'
          ? t(CONFIDENCE_KEY[estimate.basis], {
              level,
              date: formatDate(estimate.asOf),
            })
          : t('confidenceUndated', { level })}
      </p>
      {estimate.stale && <p>{t('stale')}</p>}
      {estimate.confidence === 'low' && (
        // A guess or an old sum can still rank (Opportunities, a topic action's
        // impact, a content opportunity's score): only a prompt's isn't.
        <p>{t(LOW_NOTE_KEY[estimate.basis])}</p>
      )}
      <p className="opacity-80">{t('measuredNote')}</p>
    </>
  );
}

type NotePayload = { estimate: Estimate; kind: EstimateKind };

/**
 * One method note shared by every estimate in a long table, so it mounts one
 * tooltip rather than one per row (as ClampedText does): pass it to each
 * EstimateRange and render EstimateNoteTooltip once beside them.
 */
export type EstimateNoteHandle = ReturnType<typeof createTooltipHandle<NotePayload>>;

export function createEstimateNoteHandle(): EstimateNoteHandle {
  return createTooltipHandle<NotePayload>();
}

const NOTE_CLASS = 'max-w-80 space-y-1 text-left';

/** The shared method note for a table's estimates (see createEstimateNoteHandle). */
export function EstimateNoteTooltip({ handle }: { handle: EstimateNoteHandle }) {
  return (
    <Tooltip handle={handle}>
      {({ payload }) =>
        payload ? (
          <TooltipContent className={NOTE_CLASS}>
            <EstimateNote estimate={payload.estimate} kind={payload.kind} />
          </TooltipContent>
        ) : null
      }
    </Tooltip>
  );
}

/** The trigger every estimate shares: hover or focus shows the method note. */
function WithNote({
  estimate,
  kind,
  label,
  handle,
  className,
  children,
}: {
  estimate: Estimate;
  kind: EstimateKind;
  label: string;
  handle?: EstimateNoteHandle;
  className?: string;
  children: React.ReactNode;
}) {
  const trigger = (
    <TooltipTrigger
      handle={handle}
      payload={handle ? { estimate, kind } : undefined}
      delay={300}
      closeDelay={0}
      render={
        <button
          type="button"
          aria-label={label}
          className={cn(
            'cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            className,
          )}
        />
      }
    >
      {children}
    </TooltipTrigger>
  );
  if (handle) return trigger;
  return (
    <Tooltip>
      {trigger}
      <TooltipContent className={NOTE_CLASS}>
        <EstimateNote estimate={estimate} kind={kind} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * An estimated AI volume as its range, "400–2k": grey when its confidence is
 * low, with the method note on hover or focus.
 */
export function EstimateRange({
  estimate,
  kind = 'prompt',
  handle,
  perMonth = false,
  className,
}: {
  estimate: Estimate;
  kind?: EstimateKind;
  /** A table's shared note; without one, the range carries its own. */
  handle?: EstimateNoteHandle;
  /** Adds "/mo" after the range, where nothing else says it is monthly. */
  perMonth?: boolean;
  className?: string;
}) {
  const t = useTranslations('volumeEstimate');
  const range = formatEstimateRange(estimate);
  return (
    <WithNote
      estimate={estimate}
      kind={kind}
      label={t('label', { range, level: t(`level.${estimate.confidence}`) })}
      handle={handle}
      className={cn(
        'whitespace-nowrap tabular-nums',
        estimate.confidence === 'low' && 'text-muted-foreground',
        className,
      )}
    >
      {range}
      {perMonth && <span className="font-normal">{t('perMonth')}</span>}
    </WithNote>
  );
}

/** The dashed "Estimate" badge, "Estimate · low confidence" when it is; the same note on hover. */
export function EstimateBadge({
  estimate,
  kind = 'prompt',
  className,
}: {
  estimate: Estimate;
  kind?: EstimateKind;
  className?: string;
}) {
  const t = useTranslations('volumeEstimate');
  const text = estimate.confidence === 'low' ? t('badgeLow') : t('badge');
  return (
    <WithNote
      estimate={estimate}
      kind={kind}
      label={t('badgeLabel', { level: t(`level.${estimate.confidence}`) })}
      className={cn(
        'inline-flex items-center rounded-md border border-dashed border-muted-foreground/40 px-1.5 text-[11px] font-medium leading-5 text-muted-foreground',
        className,
      )}
    >
      {text}
    </WithNote>
  );
}
