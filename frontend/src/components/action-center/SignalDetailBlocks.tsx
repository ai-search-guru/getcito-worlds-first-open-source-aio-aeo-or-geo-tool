'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { AIProviderAvatar } from '@/components/AiProviderAvatar';
import { getSignalActions, type Signal, type SignalAction } from '@/lib/actions/signals';
import { actionTexts } from '@/lib/action-center/display';
import { crawlerName, locationName, platformFamily, platformName } from '@/lib/signals/names';
import { getPlatformName } from '@/lib/trafficPlatforms';
import {
  currentActionFirst,
  METRIC_UNITS,
  PERIOD_DAYS,
  signalChange,
  signalLinks,
  signalWhereFields,
  type ChangePeriod,
  type SignalFigure,
  type WhereValue,
} from '@/lib/signals/detail';
import { languageName } from '@/lib/audit/readingEvidence';
import { cn } from '@/lib/utils';
import { ActionStatusBadge } from './ActionTable';

/**
 * The signal drawer's three blocks (AC-001): Where, What changed, and
 * Evidence and links. lib/signals/detail.ts decides what each holds; these
 * only render it.
 */

const LIST_LIMIT = 5;

function BlockTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

function NotAvailable() {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  return <span className="text-xs text-muted-foreground">{t('notAvailable')}</span>;
}

function More({ shown, total }: { shown: number; total: number }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  return total > shown ? (
    <li className="text-xs text-muted-foreground">{t('more', { count: total - shown })}</li>
  ) : null;
}

// The keys audit checks write when they fail, named in the messages; the
// rest are shown as written. A model name, and what the crawlers row
// already says, are left out.
const EVIDENCE_KEYS = [
  'aiBotsMentioned',
  'ageDays',
  'newest',
  'dateSignals',
  'blockCount',
  'blocks',
  'parsed',
  'wellFormedNodes',
  'types',
  'faqPage',
  'questionCount',
  'internalLinks',
  'matches',
  'qid',
  'label',
  'description',
  'note',
  // Readability's and first person's, in the page's language (signals/readability.js, eeat.js).
  'language',
  'formula',
  'readingScore',
  'wordsPerSentence',
  'syllablesPerWord',
  'lettersPerWord',
  'wordsPerParagraph',
  'mobileLinesPerParagraph',
  'firstPersonSentences',
  'sentences',
] as const;
const HIDDEN_EVIDENCE = new Set(['model', 'blocked', 'blockedBots']);

/**
 * An audit check's evidence as a line: "Age in days: 412 · Newest date:
 * 2025-08-30". The checks write small flat objects meant to be shown; lists
 * are joined and empty values left out.
 */
function describeEvidence(
  evidence: Record<string, unknown>,
  t: ReturnType<typeof useTranslations>,
  tFormula: ReturnType<typeof useTranslations<'contentEditor.editor.quality.formulas'>>,
): string {
  const show = (key: string, value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    // A language by its name, a reading formula as the editor names it.
    if (key === 'language' && typeof value === 'string') return languageName(value);
    if (key === 'formula' && typeof value === 'string' && tFormula.has(value)) {
      return tFormula(value as Parameters<typeof tFormula>[0]);
    }
    if (Array.isArray(value)) {
      const items = value.filter((v) => typeof v === 'string' || typeof v === 'number');
      if (items.length === 0) return null;
      return items.map((v) => (key === 'aiBotsMentioned' ? crawlerName(String(v)) : v)).join(', ');
    }
    if (typeof value === 'boolean')
      return value ? t('drawer.checkEvidence.yes') : t('drawer.checkEvidence.no');
    if (typeof value === 'object') return null;
    return String(value);
  };
  const name = (key: string) =>
    (EVIDENCE_KEYS as readonly string[]).includes(key)
      ? t(`drawer.checkEvidence.keys.${key as (typeof EVIDENCE_KEYS)[number]}`)
      : key;
  return Object.entries(evidence)
    .filter(([key]) => !HIDDEN_EVIDENCE.has(key))
    .map(([key, value]) => {
      const shown = show(key, value);
      return shown === null ? null : key === 'reason' ? shown : `${name(key)}: ${shown}`;
    })
    .filter(Boolean)
    .join(' · ');
}

function WhereValueView({ value }: { value: WhereValue }) {
  const t = useTranslations('actionCenter.signalsPage');
  const tFormula = useTranslations('contentEditor.editor.quality.formulas');
  // A competitor's page events read as the Competitors page's timeline says them.
  const tTimeline = useTranslations('competitors.timeline');
  const format = useFormatter();
  switch (value.type) {
    case 'text':
      return <span className="break-words">{value.text}</span>;
    case 'number':
      return <span className="tabular-nums">#{format.number(value.value)}</span>;
    case 'scope':
      return <span>{t(`drawer.scopes.${value.scope}`)}</span>;
    case 'prompt':
      return (
        <span className="break-words">
          {value.text}
          {value.id && (
            <Link
              href={`/dashboard/prompts/${value.id}`}
              className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
            >
              {t('drawer.viewPrompt')}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </span>
      );
    case 'prompts': {
      if (value.total === 0) return <span>{t('drawer.none')}</span>;
      if (value.items.length === 0)
        return <span>{t('affected.prompts', { count: value.total })}</span>;
      const shown = value.items.slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-0.5">
          {shown.map((item, i) => (
            <li key={item.id ?? i} className="break-words">
              {item.id ? (
                <Link
                  href={`/dashboard/prompts/${item.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {item.text}
                </Link>
              ) : (
                item.text
              )}
            </li>
          ))}
          <More shown={shown.length} total={value.total} />
        </ul>
      );
    }
    case 'list': {
      const shown = value.items.slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-0.5">
          {shown.map((item, i) => (
            <li key={i} className="break-all">
              {item}
            </li>
          ))}
          <More shown={shown.length} total={value.total} />
        </ul>
      );
    }
    case 'platforms':
      return (
        <span className="flex flex-wrap gap-1">
          {value.slugs.map((slug) => {
            const family = platformFamily(slug);
            return (
              <span
                key={slug}
                className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-xs"
              >
                {family && (
                  <span aria-hidden="true" className="flex">
                    <AIProviderAvatar provider={family} className="h-3.5 w-3.5" />
                  </span>
                )}
                {platformName(slug)}
              </span>
            );
          })}
        </span>
      );
    case 'all_platforms':
      return <span>{t('drawer.allPlatforms')}</span>;
    case 'positions':
      return (
        <ul className="space-y-1.5">
          {value.items.map((row) => (
            <li key={`${row.promptId}-${row.platform}`}>
              <Link
                href={`/dashboard/prompts/${row.promptId}`}
                className="break-words underline-offset-2 hover:underline"
              >
                {row.promptText || t('drawer.positions.untitled')}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {platformName(row.platform)} ·{' '}
                {value.competitor || t('drawer.change.roles.unnamed')}{' '}
                <PositionMove position={row.competitor} side="competitor" /> ·{' '}
                {t('drawer.positions.you')} <PositionMove position={row.you} side="you" />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'crawlers':
      return <span>{value.agents.map(crawlerName).join(', ')}</span>;
    case 'trafficPages': {
      const shown = value.items.slice(0, LIST_LIMIT);
      // Engagement is a share of sessions; key events are counted per
      // session, which can pass one.
      const percent = (share: number) =>
        format.number(share, { style: 'percent', maximumFractionDigits: 0 });
      const perSession = (rate: number) => format.number(rate, { maximumFractionDigits: 2 });
      const versus = (
        key: 'engagement' | 'keyRate',
        value: number,
        site: number | null,
        shown: (n: number) => string,
      ) =>
        site === null
          ? t(`drawer.trafficPages.${key}`, { rate: shown(value) })
          : t(`drawer.trafficPages.${key}VsSite`, { rate: shown(value), site: shown(site) });
      return (
        <ul className="space-y-2">
          {shown.map((item) => {
            // The sessions, then what the finding was raised on.
            const facts: string[] = [];
            if (item.sessions !== null && item.before !== null) {
              facts.push(
                t('drawer.trafficPages.sessions', {
                  before: format.number(item.before),
                  now: format.number(item.sessions),
                }),
              );
            }
            for (const metric of value.metrics) {
              if (metric === 'engagement' && item.engagedRate !== null) {
                facts.push(versus('engagement', item.engagedRate, value.siteEngagedRate, percent));
              }
              if (metric === 'keyRate' && item.keyRate !== null) {
                facts.push(versus('keyRate', item.keyRate, value.siteKeyRate, perSession));
              }
              if (metric === 'keyEvents' && item.keyEvents !== null) {
                facts.push(
                  t('drawer.trafficPages.keyEvents', {
                    before: format.number(item.keyEventsBefore ?? 0),
                    now: format.number(item.keyEvents),
                  }),
                );
              }
            }
            return (
              <li key={item.page}>
                <span className="block break-all">{item.page}</span>
                <span className="block text-xs text-muted-foreground">
                  {facts.map((fact, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      <span className="whitespace-nowrap">{fact}</span>
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
          <More shown={shown.length} total={value.total} />
        </ul>
      );
    }
    case 'referrals': {
      const shown = value.items.slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-2">
          {shown.map((item) => (
            <li key={item.page ?? ''}>
              {/* One page is the one the fields above name already. */}
              {item.page && shown.length > 1 && (
                <span className="block break-all">{item.page}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {item.platforms.length
                  ? item.platforms.map((p, i) => (
                      <span key={p.platform}>
                        {i > 0 && ' · '}
                        <span className="whitespace-nowrap">
                          {`${getPlatformName(p.platform)} ${format.number(p.before)} → ${format.number(p.sessions)}`}
                        </span>
                      </span>
                    ))
                  : t('drawer.referrals.none')}
              </span>
            </li>
          ))}
          <More shown={shown.length} total={value.items.length} />
          <li className="text-xs text-muted-foreground">
            {t('drawer.referrals.period', { days: value.days })}
          </li>
        </ul>
      );
    }
    case 'issues': {
      // Page by page, each failed check with what it found.
      const byPage = new Map<string, typeof value.items>();
      for (const issue of value.items) {
        byPage.set(issue.page, [...(byPage.get(issue.page) ?? []), issue]);
      }
      const pages = [...byPage].slice(0, LIST_LIMIT);
      return (
        <ul className="space-y-2">
          {pages.map(([page, issues]) => (
            <li key={page}>
              <span className="break-all">{page}</span>
              {issues.map((issue) => {
                const found = describeEvidence(issue.evidence, t, tFormula);
                return (
                  <span key={issue.check} className="block text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{issue.label}</span>
                    {found && ` · ${found}`}
                  </span>
                );
              })}
            </li>
          ))}
          <More shown={pages.length} total={byPage.size} />
        </ul>
      );
    }
    case 'mentions':
      return (
        <ul className="space-y-2.5">
          {value.items.map((m) => (
            <li key={m.promptId}>
              <Link
                href={`/dashboard/prompts/${m.promptId}`}
                className="break-words underline-offset-2 hover:underline"
              >
                {m.promptText || t('drawer.positions.untitled')}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {[
                  m.platforms.map(platformName).join(', '),
                  m.position !== null &&
                    t('drawer.cited.position', {
                      position: format.number(m.position, { maximumFractionDigits: 1 }),
                    }),
                  m.sentiment && t(`drawer.mentions.sentiment.${m.sentiment}`),
                  t('drawer.cited.answers', { count: m.answers }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {m.excerpt && (
                <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground italic">
                  “{m.excerpt}”
                  {m.excerptPlatform && m.excerptAt && (
                    <span className="mt-0.5 block not-italic">
                      {t('drawer.mentions.quotedFrom', {
                        platform: platformName(m.excerptPlatform),
                        date: format.dateTime(new Date(m.excerptAt), {
                          month: 'short',
                          day: 'numeric',
                        }),
                      })}
                    </span>
                  )}
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      );
    case 'sources':
      return (
        <ul className="space-y-1">
          {value.items.map((source) => (
            <li key={source.domain}>
              <span className="break-all">{source.domain}</span>
              <span className="block text-xs text-muted-foreground">
                {t('drawer.positions.sourceAnswers', {
                  count: source.answers,
                  of: source.answersRead,
                })}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'pageEvents':
      return (
        <div className="space-y-1.5">
          {value.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('drawer.pageEvents.none', { days: value.days })}
            </p>
          ) : (
            <ul className="space-y-1">
              {value.items.map((event) => {
                const checks = (list: { label: string }[]) => list.map((c) => c.label).join(', ');
                const what =
                  event.kind === 'first_cited'
                    ? [tTimeline('firstCited')]
                    : [
                        tTimeline('changed'),
                        event.gained.length > 0 &&
                          tTimeline('gained', { checks: checks(event.gained) }),
                        event.lost.length > 0 && tTimeline('lost', { checks: checks(event.lost) }),
                        event.gained.length + event.lost.length === 0 && tTimeline('changedWords'),
                      ];
                return (
                  <li key={`${event.kind}-${event.url}-${event.at}`}>
                    <span className="break-all">
                      {event.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        format.dateTime(new Date(event.at), { month: 'short', day: 'numeric' }),
                        ...what,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {value.competitorId && (
            <Link
              href={`/dashboard/competitors?competitor=${value.competitorId}`}
              className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
            >
              {t('drawer.pageEvents.timeline')}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      );
    case 'citations':
      return (
        <ul className="space-y-1">
          {value.items.map((page, i) => (
            <li key={i}>
              <span className="break-all">{page.url.replace(/^https?:\/\//, '')}</span>
              <span className="block text-xs text-muted-foreground">
                {[
                  page.position !== null && t('drawer.cited.position', { position: page.position }),
                  page.lastCitedAt &&
                    t('drawer.cited.lastCited', {
                      date: format.dateTime(new Date(page.lastCitedAt), {
                        month: 'short',
                        day: 'numeric',
                      }),
                    }),
                  page.answers !== undefined &&
                    (page.answersRead !== undefined
                      ? t('drawer.cited.answersOf', { count: page.answers, of: page.answersRead })
                      : t('drawer.cited.answers', { count: page.answers })),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'locations':
      return <span>{value.codes.map(locationName).join(', ')}</span>;
  }
}

/**
 * "#1 ↑2": a position this week and how it moved since last week (1 is named
 * first, so a smaller number is up). "—" when not named this week. Coloured
 * as news for the brand: its own climb is good, a competitor's is not.
 */
function PositionMove({
  position,
  side,
}: {
  position: { now: number | null; before: number | null };
  side: 'competitor' | 'you';
}) {
  const t = useTranslations('actionCenter.signalsPage.drawer.positions');
  const format = useFormatter();
  const n = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  if (position.now === null) {
    return (
      <span className="font-medium text-foreground">
        —
        {position.before !== null && (
          <span className="text-red-600 dark:text-red-400"> {t('lost')}</span>
        )}
      </span>
    );
  }
  const moved =
    position.before === null ? null : Math.round((position.before - position.now) * 10) / 10;
  const tone = (up: boolean) =>
    up !== (side === 'competitor')
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  return (
    <span className="font-medium text-foreground">
      #{n(position.now)}
      {moved === null ? (
        <span className="text-muted-foreground"> {t('new')}</span>
      ) : moved > 0 ? (
        <span className={tone(true)}> ↑{n(moved)}</span>
      ) : moved < 0 ? (
        <span className={tone(false)}> ↓{n(-moved)}</span>
      ) : (
        <span className="text-muted-foreground"> =</span>
      )}
    </span>
  );
}

export function SignalWhereBlock({ signal }: { signal: Signal }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const fields = signalWhereFields(signal);
  if (fields.length === 0) return null;
  return (
    <div>
      <BlockTitle>{t('where')}</BlockTitle>
      <dl className="mt-2 grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
        {fields.map(({ key, value }) => (
          <div key={key} className="contents">
            <dt className="text-xs text-muted-foreground">{t(`fields.${key}`)}</dt>
            <dd className="min-w-0 text-sm">
              {value ? <WhereValueView value={value} /> : <NotAvailable />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function useFigureText(period: ChangePeriod) {
  const t = useTranslations('actionCenter.signalsPage.drawer.change');
  const format = useFormatter();

  const value = (figure: Pick<SignalFigure, 'metric' | 'value' | 'of'>, signed = false) => {
    const unit = METRIC_UNITS[figure.metric];
    const n = format.number(Math.abs(figure.value), { maximumFractionDigits: 1 });
    if (figure.of !== undefined) return `${n} / ${format.number(figure.of)}`;
    const sign = signed ? (figure.value > 0 ? '+' : figure.value < 0 ? '−' : '') : '';
    if (unit === 'percent') return signed ? t('points', { value: `${sign}${n}` }) : `${n}%`;
    if (unit === 'points') return t('points', { value: `${sign}${n}` });
    if (unit === 'rank') return `#${n}`;
    return `${sign}${n}`;
  };

  // The subject is a stored slug or code; say it the way people do.
  const subject = (figure: SignalFigure) => {
    const raw = figure.subject ?? '';
    if (!raw) return '';
    if (figure.subjectType === 'location') return locationName(raw);
    if (figure.subjectType === 'platform') return platformName(raw);
    return raw;
  };

  // "Mention rate · last 7 days", "Mentions · Profound · last 7 days",
  // "Mention rate · United States (best)": the metric, whose, and when.
  const label = (figure: SignalFigure) => {
    const name = subject(figure);
    const overTime = ['before', 'after', 'earlier', 'latest', 'change'].includes(figure.role);
    return [
      t(`metrics.${figure.metric}`),
      overTime && name ? name : null,
      t(`roles.${figure.role}`, {
        name: name || t('roles.unnamed'),
        // Only a before and an after say their days: "previous 14 days".
        days: PERIOD_DAYS[period] ?? '',
      }),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return { value, label };
}

export function SignalChangeBlock({ signal }: { signal: Signal }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const change = signalChange(signal);

  return (
    <div>
      <BlockTitle>{t('whatChanged')}</BlockTitle>
      {!change ? (
        <p className="mt-1">
          <NotAvailable />
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(`change.periods.${change.period}`)}
          </p>
          <div className="mt-2 space-y-2">
            {groupByMetric(change.figures).map((figures) => {
              // A metric read over another window says which, above its row.
              const period = figures[0].period ?? change.period;
              return (
                <div key={figures[0].metric}>
                  {period !== change.period && (
                    <p className="mb-1 text-xs text-muted-foreground">
                      {t(`change.periods.${period}`)}
                    </p>
                  )}
                  <FigureRow figures={figures} period={period} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** One metric's figures: a before and an after with the difference, or side by side. */
function FigureRow({ figures, period }: { figures: SignalFigure[]; period: ChangePeriod }) {
  const { value, label } = useFigureText(period);
  const before = figures.find((f) => f.role === 'before' || f.role === 'earlier');
  const after = figures.find((f) => f.role === 'after' || f.role === 'latest');
  if (before && after) {
    // Days out of different totals have no meaningful difference.
    const delta =
      after.of === undefined
        ? { metric: after.metric, value: after.value - before.value }
        : { metric: after.metric, value: 0 };
    // A rise is good news for the brand's own numbers and bad news for a
    // competitor's.
    const good = delta.value >= 0 !== (after.subjectType === 'competitor');
    return (
      <div className="flex flex-wrap items-center gap-2">
        <FigureBox label={label(before)} value={value(before)} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <FigureBox label={label(after)} value={value(after)} />
        {delta.value !== 0 && (
          <span
            className={cn(
              'text-xs font-medium',
              good ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {value(delta, true)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {figures.map((figure) => (
        <FigureBox
          key={figure.role + (figure.subject ?? '')}
          label={label(figure)}
          value={value(figure, figure.role === 'change')}
        />
      ))}
    </div>
  );
}

/** Figures of one metric together, in their order: one comparison per row. */
function groupByMetric(figures: SignalFigure[]): SignalFigure[][] {
  const groups = new Map<string, SignalFigure[]>();
  for (const figure of figures) {
    groups.set(figure.metric, [...(groups.get(figure.metric) ?? []), figure]);
  }
  return [...groups.values()];
}

function FigureBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] rounded-lg border px-3 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function SignalEvidenceBlock({ signal, brandId }: { signal: Signal; brandId: string }) {
  const t = useTranslations('actionCenter.signalsPage.drawer');
  const tActions = useTranslations('actionCenter.actionTexts');
  // Loaded per signal and current action; until the answer for them arrives
  // it is loading. A signal is linked to an action only by becoming its
  // current one, and deleting an action drops both, so a signal without one
  // is used by none and isn't asked about.
  const [loaded, setLoaded] = useState<{
    key: string;
    actions: SignalAction[] | null;
  } | null>(null);
  const signalId = signal.id;
  const key = signal.actionId ? `${signalId}|${signal.actionId}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getSignalActions(brandId, signalId)
      .then((rows) => {
        if (!cancelled) setLoaded({ key, actions: rows });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, actions: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, signalId, key]);

  const current = key && loaded?.key === key ? loaded : null;
  const actions: SignalAction[] | 'loading' | 'failed' = !key
    ? []
    : !current
      ? 'loading'
      : current.actions
        ? currentActionFirst(current.actions, signal.actionId)
        : 'failed';

  const stamp = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div className="space-y-3">
      <BlockTitle>{t('evidence')}</BlockTitle>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {signalLinks(signal).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            {t(`links.${link.kind}`)}
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <div>
          <p className="text-muted-foreground">{t('detected')}</p>
          <p className="mt-0.5 tabular-nums">{stamp(signal.detectedAt)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('lastDetected')}</p>
          <p className="mt-0.5 tabular-nums">{stamp(signal.lastDetectedAt)}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t('usedBy')}</p>
        <div className="mt-1 text-xs">
          {actions === 'failed' ? (
            <span className="text-muted-foreground">{t('usedByFailed')}</span>
          ) : actions === 'loading' ? (
            <span className="text-muted-foreground">{t('loading')}</span>
          ) : actions.length === 0 ? (
            <span className="text-muted-foreground">{t('usedByNone')}</span>
          ) : (
            <ul className="space-y-1">
              {actions.map((action) => (
                <li key={action.id}>
                  <Link
                    href={`/dashboard/action-center/actions?action=${action.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 hover:bg-muted"
                  >
                    <span className="inline-flex min-w-0 items-start gap-1 font-medium">
                      {t('actionLabel', {
                        no: action.actionNo,
                        title: actionTexts(action, tActions).title,
                      })}
                      <ArrowUpRight className="mt-px h-3 w-3 shrink-0" />
                    </span>
                    <ActionStatusBadge status={action.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
