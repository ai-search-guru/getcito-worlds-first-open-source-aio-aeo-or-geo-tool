'use client';

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, ChevronDown, Copy, ExternalLink, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Components } from 'react-markdown';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/useUserRole';
import { getMentionResponse } from '@/lib/actions/mentions';
import { classifyDomain, extractHostname, SOURCE_CATEGORY_LABELS } from '@/lib/citations/classify';
import { stripEntityMarkup } from '@/lib/entityMarkup';
import { mentionPlatformLabel } from '@/lib/mentionsHeadline';
import type { MentionRow, MentionSentiment, SentimentOverride } from '@/lib/mentionsList';
import { formatRegionDisplay } from '@/lib/region';
import { cn } from '@/lib/utils';
import type { Citation } from '@/types';
import {
  Highlighted,
  highlightChildren,
  MARK_CLASS,
  SentimentPill,
  type MentionNames,
} from './_MentionParts';
import { SentimentCorrection } from './_SentimentCorrection';
import type { useMentionActions } from './_useMentionActions';

type Loaded =
  | {
      id: string;
      status: 'ok';
      response: string;
      citations: Citation[];
      override: SentimentOverride | null;
    }
  | { id: string; status: 'missing' | 'error' };

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

/**
 * The response drawer (MS-08, read-only in V1): the answer's prompt,
 * platform and model, country, date and time; its sentiment and the brand's
 * position; the passage around the mention; the competitors named beside
 * you; the full stored answer with your brand marked in ink and
 * competitors in grey; and the sources it cites, typed as on the Citations
 * page. Its footer sends the answer to the Action Center, suggests content
 * for its prompt, and copies it; correcting the sentiment comes next.
 */
export function ResponseDrawer({
  brandId,
  row,
  names,
  domains,
  actions,
  canCorrect,
  onSentimentChanged,
  onClose,
}: {
  brandId: string;
  row: MentionRow | null;
  names: MentionNames;
  /** For typing the cited sources: your domains and the competitors'. */
  domains: { brand: string[]; competitors: string[] };
  /** Send the answer to the Action Center, or suggest content for its prompt. */
  actions: Pick<
    ReturnType<typeof useMentionActions>,
    'send' | 'sending' | 'suggest' | 'suggesting'
  >;
  /** Admins and managers may correct the sentiment ("Sentiment is wrong"). */
  canCorrect: boolean;
  onSentimentChanged: (id: string, sentiment: MentionSentiment) => void;
  onClose: () => void;
}) {
  const t = useTranslations('mentions.drawer');
  const tActions = useTranslations('mentions.actions');
  // Suggesting content costs AI: admins and managers start it.
  const { canManage } = useUserRole();
  const locale = useLocale();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showResponse, setShowResponse] = useState(true);
  const id = row?.id ?? null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getMentionResponse(brandId, id)
      .then((answer) => {
        if (cancelled) return;
        setLoaded(answer ? { id, status: 'ok', ...answer } : { id, status: 'missing' });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, id]);

  // A previous answer's text never shows under this one's header.
  const answer = loaded && loaded.id === id ? loaded : null;
  // A correction made here shows at once, before the answer is read again.
  const [corrected, setCorrected] = useState<{
    id: string;
    override: SentimentOverride | null;
  } | null>(null);
  const override =
    corrected && corrected.id === id
      ? corrected.override
      : answer?.status === 'ok'
        ? answer.override
        : null;
  const response = answer?.status === 'ok' ? stripEntityMarkup(answer.response) : '';

  // The marks inside the rendered answer; keyed below so new names re-render it.
  const components = useMemo<Partial<Components>>(() => {
    type Tag = 'p' | 'li' | 'td' | 'th' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'blockquote';
    const mark = (Tag: Tag) => {
      function Marked({ children, node, ...props }: ComponentProps<Tag> & { node?: unknown }) {
        void node;
        return <Tag {...(props as object)}>{highlightChildren(children, names)}</Tag>;
      }
      return Marked;
    };
    return {
      p: mark('p'),
      li: mark('li'),
      td: mark('td'),
      th: mark('th'),
      h1: mark('h1'),
      h2: mark('h2'),
      h3: mark('h3'),
      h4: mark('h4'),
      h5: mark('h5'),
      h6: mark('h6'),
      blockquote: mark('blockquote'),
    };
  }, [names]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(response);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const platform = row ? mentionPlatformLabel(row.platform) : '';
  const when = row
    ? new Date(row.createdAt).toLocaleString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const chip = 'inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs';

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        aria-label={t('label')}
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        {row && (
          <>
            <SheetHeader className="gap-2 border-b px-5 py-4 pr-12">
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-foreground">
                <span className={chip}>
                  <AIProviderAvatar
                    plain
                    provider={resolveAIProvider(row.platform, row.platform)}
                    className="h-4 w-4"
                  />
                  {row.model ? `${platform} · ${row.model}` : platform}
                </span>
                {row.region && <span className={chip}>{formatRegionDisplay(row.region)}</span>}
                <span className={chip}>{when}</span>
              </SheetDescription>
              <SheetTitle className="text-base leading-snug break-words">
                {row.promptText}
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <SentimentPill sentiment={row.sentiment} />
                {row.position !== null && (
                  <span className={chip}>
                    {row.brandsNamed
                      ? t('position', { position: row.position, count: row.brandsNamed })
                      : t('positionOnly', { position: row.position })}
                  </span>
                )}
                {row.topicName && (
                  <span className={chip}>{t('topic', { topic: row.topicName })}</span>
                )}
                <Link
                  href={`/dashboard/prompts/${row.promptId}`}
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                >
                  {t('viewPrompt')}
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
              <SentimentCorrection
                key={row.id}
                row={row}
                override={override}
                canCorrect={canCorrect}
                onCorrected={(sentiment, next) => {
                  setCorrected({ id: row.id, override: next });
                  onSentimentChanged(row.id, sentiment);
                }}
              />

              <Section title={t('mention')}>
                <blockquote className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2 text-sm leading-relaxed">
                  <Highlighted text={row.excerpt} names={names} />
                </blockquote>
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <mark className={MARK_CLASS.brand}>{t('legendBrand')}</mark>
                  <mark className={MARK_CLASS.competitor}>{t('legendCompetitor')}</mark>
                </p>
              </Section>

              <Section title={t('coMentioned')}>
                {row.coMentioned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noCoMentions')}</p>
                ) : (
                  <>
                    <ul className="flex flex-wrap gap-1.5">
                      {row.coMentioned.map((c) => (
                        <li key={c.competitorId} className={chip}>
                          {c.name}
                          {c.position !== null && (
                            <span className="text-muted-foreground">#{c.position}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">{t('competitorTone')}</p>
                  </>
                )}
              </Section>

              <Section
                title={t('response')}
                aside={
                  <span className="font-normal normal-case tracking-normal">({t('stored')})</span>
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-7 px-2 text-xs"
                  aria-expanded={showResponse}
                  onClick={() => setShowResponse((v) => !v)}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      !showResponse && '-rotate-90',
                    )}
                  />
                  {showResponse ? t('hideResponse') : t('showResponse')}
                </Button>
                {showResponse &&
                  (!answer ? (
                    <div className="space-y-2" aria-label={t('loading')}>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-11/12" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  ) : answer.status === 'ok' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Markdown
                        key={`${row.id}:${names.brand.join('|')}:${names.competitors.join('|')}`}
                        components={components}
                      >
                        {response}
                      </Markdown>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {answer.status === 'missing' ? t('missing') : t('loadError')}
                    </p>
                  ))}
              </Section>

              {answer?.status === 'ok' && (
                <Section title={`${t('citations')} (${answer.citations.length})`}>
                  {answer.citations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('noCitations')}</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {answer.citations.map((cite, i) => {
                        const host = extractHostname(cite.url) ?? cite.url;
                        const category = classifyDomain(host, {
                          brandDomains: domains.brand,
                          competitorDomains: domains.competitors,
                        });
                        return (
                          <li key={`${cite.url}-${i}`}>
                            <a
                              href={cite.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-start gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                            >
                              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">
                                  {cite.title || host}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {host}
                                </span>
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 shrink-0 px-1.5 text-[11px]',
                                  category === 'you' &&
                                    'border-primary/30 bg-primary/10 text-foreground',
                                )}
                              >
                                {SOURCE_CATEGORY_LABELS[category]}
                              </Badge>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Section>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => actions.send([row])} disabled={actions.sending}>
                  <Send className="h-3.5 w-3.5" />
                  {tActions('sendToActionCenter')}
                </Button>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => actions.suggest(row)}
                    disabled={actions.suggesting === row.promptId}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {tActions('suggestContent')}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copy}
                  disabled={answer?.status !== 'ok'}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('copy')}
                </Button>
              </div>
              <SheetClose render={<Button variant="ghost" size="sm" />}>{t('close')}</SheetClose>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
