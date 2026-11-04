'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import {
  getQueryFanout,
  trackFanoutQuery,
  classifyFanoutIntents,
  type QueryFanoutData,
  type FanoutSubQuery,
} from '@/lib/actions/fanout';
import { INTENT_LABELS, INTENT_COLORS } from '@/config/intentLabels';
import type { PromptRange } from '@/config/promptOptions';
import { PlatformsCell } from '@/components/citations/SourceCells';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, ChevronRight, Plus, Loader2, Search } from 'lucide-react';
import { usePagination, TablePager } from '@/components/TablePager';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useTopicFirstDialog } from '@/components/prompts/TopicFirst';
import { isNoTopics } from '@/lib/topicsRequired';
import {
  FanoutEngineNotices,
  FanoutEngineStrip,
  PromptEnginesCell,
  platformLabel,
} from './_FanoutEngines';

type View = 'frequency' | 'by-prompt';

interface PromptGroup {
  prompt: { id: string; text: string };
  subQueries: FanoutSubQuery[];
  /** Tracked answers for this prompt in the window (the coverage denominator). */
  totalRuns: number;
  /** Of those, how many triggered at least one live search. */
  runsWithFanout: number;
  /** Platforms that answered it, and those whose answers shared searches. */
  platforms: string[];
  fanoutPlatforms: string[];
}

type QueryFanoutTabProps = {
  brandId: string;
  /** Window shared with the rest of the Prompts page (#686). */
  range: PromptRange | null;
  rangeLabel: string;
  onTracked?: () => void | Promise<void>;
  /** "Add a topic" on a brand without one: the page's Topics tab, with Add Topic open. */
  onAddTopic?: () => void;
};

/**
 * Background intent-classification batch size (#431). One request per chunk:
 * a chunk of 20 cold queries is at most ~4 LLM waves on the server
 * (concurrency 6), comfortably inside the action's 20s fetch timeout —
 * classifying the whole observed set in one request was not (120 cold
 * queries ≈ 40s+, aborted, badges never arrived that session).
 */
const INTENT_CHUNK_SIZE = 20;

const FANOUT_PAGE_SIZE = 10;

/**
 * Server-action failures reach the client with Next's production-masked
 * message ("An error occurred in the Server Components render… A digest
 * property is included…"), which is meaningless to users (#427). Surface the
 * real message only when it survived; otherwise fall back to a friendly one.
 */
function userErrorMessage(err: unknown, fallback: string): string {
  if (
    err instanceof Error &&
    err.message &&
    !/^An error occurred in the Server/i.test(err.message)
  ) {
    return err.message;
  }
  return fallback;
}

export function QueryFanoutTab({
  brandId,
  range,
  rangeLabel,
  onTracked,
  onAddTopic,
}: QueryFanoutTabProps) {
  const [data, setData] = useState<QueryFanoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // Intent is keyed by the lower-cased sub-query (matches the server cache key).
  const [intents, setIntents] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>('by-prompt');
  const [searchText, setSearchText] = useState('');
  // The engine chip picked above the lists; null shows every engine.
  const [engine, setEngine] = useState<string | null>(null);
  // A read-only workspace (plan not active): Track opens the upgrade dialog
  // instead, and the intents (an AI call the API refuses then) aren't asked.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // A brand with no topic yet: Track asks for one first.
  const topicFirst = useTopicFirstDialog({ onAddTopic });

  // Mirror of `intents` for the async classification chain (avoids stale
  // closures), plus a run counter so a reload/brand switch/unmount cancels
  // the previous chain instead of racing it.
  const intentsRef = useRef<Record<string, string>>({});
  const intentRunRef = useRef(0);

  const filteredSubQueries = useMemo<FanoutSubQuery[]>(() => {
    if (!data) return [];
    const lower = searchText.toLowerCase();
    return data.subQueries.filter(
      (sq) =>
        (!engine || sq.engines.includes(engine)) &&
        (!searchText || sq.query.toLowerCase().includes(lower)),
    );
  }, [data, searchText, engine]);

  // Shared pager for the HighFrequencyView — reset whenever brandId, view, the engine or the search term changes.
  const pager = usePagination(
    filteredSubQueries.length,
    // resetKey: changing brand, switching away from/back to frequency view, picking an engine or typing a search term resets to page 0
    `${brandId}::${view}::${engine}::${searchText}`,
    FANOUT_PAGE_SIZE,
  );

  /**
   * Classify intents progressively (#431): the visible page's queries first
   * (the list is frequency-sorted, which is exactly page order), then the
   * rest in background chunks, merging each chunk into state as it resolves.
   * Never awaited by the table load — badges fill in; rows never wait.
   */
  const classifyProgressively = useCallback(async (queries: string[]) => {
    const run = ++intentRunRef.current;
    const pending = queries.filter((q) => !(q.toLowerCase() in intentsRef.current));
    if (pending.length === 0) return;

    const chunks: string[][] = [pending.slice(0, FANOUT_PAGE_SIZE)];
    for (let i = FANOUT_PAGE_SIZE; i < pending.length; i += INTENT_CHUNK_SIZE) {
      chunks.push(pending.slice(i, i + INTENT_CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      if (intentRunRef.current !== run) return;
      try {
        const map = await classifyFanoutIntents(chunk);
        if (intentRunRef.current !== run) return;
        intentsRef.current = { ...intentsRef.current, ...map };
        setIntents(intentsRef.current);
      } catch {
        // A failed/timed-out chunk must not kill the chain — its rows keep
        // the "—" placeholder and the next chunk still gets its shot.
      }
    }
  }, []);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
      }
      try {
        const result = await getQueryFanout(brandId, {
          days: range?.days,
          from: range?.from,
          to: range?.to,
        });
        setData(result);
        if (!isLocked) void classifyProgressively(result.subQueries.map((s) => s.query));
      } catch (err) {
        console.error('[fanout] load failed', err);
        toast.error(userErrorMessage(err, 'Failed to load query fan-out — please retry.'));
        setData({
          subQueries: [],
          totalObserved: 0,
          promptCoverage: [],
          engines: [],
          truncated: false,
        });
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [brandId, range, classifyProgressively, isLocked],
  );

  useEffect(() => {
    load();
    // Cancel the in-flight classification chain on unmount/brand switch.
    return () => {
      intentRunRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setSearchText('');
    setEngine(null);
  }, [brandId, range]);

  useEffect(() => {
    setSearchText('');
  }, [view]);

  // Seed from the server's coverage list so every prompt with a run in the
  // window gets a row — including the ones the engines never searched for,
  // which the sub-query → prompts inversion alone can't produce. Then invert
  // sub-query → prompts to hang each prompt's observed fan-out off its row.
  const byPrompt = useMemo<PromptGroup[]>(() => {
    if (!data) return [];
    const map = new Map<string, PromptGroup>();
    for (const c of data.promptCoverage) {
      map.set(c.id, {
        prompt: { id: c.id, text: c.text },
        subQueries: [],
        totalRuns: c.totalRuns,
        runsWithFanout: c.runsWithFanout,
        platforms: c.platforms,
        fanoutPlatforms: c.fanoutPlatforms,
      });
    }
    for (const sq of data.subQueries) {
      for (const p of sq.sourcedPrompts) {
        // Defensive: a sourced prompt should always have a coverage entry.
        if (!map.has(p.id)) {
          map.set(p.id, {
            prompt: p,
            subQueries: [],
            totalRuns: 0,
            runsWithFanout: 0,
            platforms: [],
            fanoutPlatforms: [],
          });
        }
        map.get(p.id)!.subQueries.push(sq);
      }
    }
    // Text is the final key so the order is fully determined: without it, rows
    // tied on both counts could reshuffle between renders and appear to jump
    // pages. The server hands `promptCoverage` over unsorted by design.
    return [...map.values()].sort(
      (a, b) =>
        b.subQueries.length - a.subQueries.length ||
        b.totalRuns - a.totalRuns ||
        a.prompt.text.localeCompare(b.prompt.text),
    );
  }, [data]);

  const filteredByPrompt = useMemo<PromptGroup[]>(() => {
    const lower = searchText.toLowerCase();
    const groups = searchText
      ? byPrompt.filter((group) => group.prompt.text.toLowerCase().includes(lower))
      : byPrompt;
    if (!engine) return groups;
    // With an engine picked, a prompt shows that engine's searches only, and
    // a prompt it shared none for drops out.
    return groups
      .map((group) => ({
        ...group,
        subQueries: group.subQueries.filter((sq) => sq.engines.includes(engine)),
      }))
      .filter((group) => group.subQueries.length > 0);
  }, [byPrompt, searchText, engine]);

  // The By-prompt list now covers every tracked prompt with a run in the
  // window, not just those with observed fan-out, so it needs its own pager.
  const byPromptPager = usePagination(
    filteredByPrompt.length,
    `${brandId}::${view}::${engine}::${searchText}`,
    FANOUT_PAGE_SIZE,
  );

  async function handleTrack(query: string) {
    setAddingKey(query.toLowerCase());
    try {
      const result = await trackFanoutQuery(brandId, query);
      if ('error' in result) {
        if (isNoTopics(result)) topicFirst.show();
        else toast.error(result.error);
        return;
      }
      toast.success('Added as a tracked prompt');
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          subQueries: prev.subQueries.map((sq) => {
            if (sq.query.toLowerCase() === query.toLowerCase()) {
              return {
                ...sq,
                tracked: true,
                trackedPromptId: result.promptId,
              };
            }
            return sq;
          }),
        };
      });
      await load({ silent: true });
      await onTracked?.();
    } catch (err) {
      console.error('[fanout] track failed', err);
      toast.error(userErrorMessage(err, 'Failed to track this query — please retry.'));
    } finally {
      setAddingKey(null);
    }
  }

  // Only truly empty when there is nothing to say in EITHER view. Gating on
  // sub-queries alone hid the By-prompt table for any brand whose engines never
  // fan out (ChatGPT-only, say) — which is exactly the brand whose 0 / N rows
  // are the useful answer.
  const isEmpty = !data || (data.subQueries.length === 0 && data.promptCoverage.length === 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm font-medium">Query Fan-out</CardTitle>
          {!loading && !isEmpty && (
            <div className="flex rounded-md border p-0.5">
              <button
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === 'by-prompt'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('by-prompt')}
              >
                By prompt
              </button>
              <button
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  view === 'frequency'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setView('frequency')}
              >
                High frequency
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {view === 'by-prompt'
            ? 'Your tracked prompts grouped by the sub-queries their answers actually triggered — expand a prompt to see its observed fan-out. "Answers with fan-out" is how many of that prompt’s tracked answers ran a live search at all.'
            : `The sub-queries answer engines actually ran while building your answers (${rangeLabel}) — observed, never predicted. Sorted by how often they were searched. Track any of them with the + to measure its own visibility.`}
        </p>
      </CardHeader>
      <CardContent>
        {!loading && data && data.engines.length > 0 && (
          <div className="mb-4 space-y-2.5">
            <FanoutEngineStrip
              engines={data.engines}
              totalSubQueries={data.totalObserved}
              selected={engine}
              onSelect={setEngine}
            />
            <FanoutEngineNotices engines={data.engines} />
          </div>
        )}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState />
        ) : view === 'frequency' ? (
          <HighFrequencyView
            subQueries={filteredSubQueries}
            intents={intents}
            addingKey={addingKey}
            pager={pager}
            rangeLabel={rangeLabel}
            engine={engine}
            onTrack={guard(handleTrack, { action: tActions('trackPrompts') })}
            searchText={searchText}
            onSearchChange={setSearchText}
          />
        ) : (
          <ByPromptView
            groups={filteredByPrompt}
            intents={intents}
            addingKey={addingKey}
            pager={byPromptPager}
            rangeLabel={rangeLabel}
            engine={engine}
            onTrack={guard(handleTrack, { action: tActions('trackPrompts') })}
            searchText={searchText}
            onSearchChange={setSearchText}
          />
        )}
        {!loading && data?.truncated && (
          <p className="pt-3 text-[11px] text-muted-foreground">
            This brand has more tracked answers in this window than one read covers, so the most
            recent ones are missing — counts and coverage here are a lower bound.
          </p>
        )}
        {topicFirst.dialog}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  const t = useTranslations('prompts.fanout');
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">{t('emptyTitle')}</p>
      <p className="max-w-md text-xs text-muted-foreground">{t('emptyBody')}</p>
    </div>
  );
}

/** An engine is picked and shared nothing in the window. */
function EngineEmptyState({ engine, rangeLabel }: { engine: string; rangeLabel: string }) {
  const t = useTranslations('prompts.fanout');
  const label = platformLabel(engine);
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">
        {t('engineEmptyTitle', { engine: label, range: rangeLabel })}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        {t('engineEmptyBody', { engine: label })}
      </p>
    </div>
  );
}

/** Zero-row state for a filtered list — the search matched nothing. */
function NoMatches({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Search className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

function HighFrequencyView({
  subQueries,
  intents,
  addingKey,
  pager,
  rangeLabel,
  engine,
  onTrack,
  searchText,
  onSearchChange,
}: {
  subQueries: FanoutSubQuery[];
  intents: Record<string, string>;
  addingKey: string | null;
  pager: ReturnType<typeof usePagination>;
  rangeLabel: string;
  engine: string | null;
  onTrack: (query: string) => void;
  searchText: string;
  onSearchChange: (text: string) => void;
}) {
  const pageRows = subQueries.slice(pager.start, pager.end);

  return (
    <div className="space-y-4">
      <FanoutSearchInput
        value={searchText}
        onChange={onSearchChange}
        placeholder="Search sub-queries…"
      />
      {subQueries.length === 0 ? (
        // Unfiltered and still empty means nothing fanned out at all — the tab
        // no longer gates on that, so this view has to explain it itself.
        searchText ? (
          <NoMatches label="No sub-queries match your search" />
        ) : engine ? (
          <EngineEmptyState engine={engine} rangeLabel={rangeLabel} />
        ) : (
          <EmptyState />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sub-query</TableHead>
                <TableHead className="w-[160px]">Engine</TableHead>
                <TableHead className="w-[120px] text-right">Times searched</TableHead>
                <TableHead className="w-[220px]">Sourced prompts</TableHead>
                <TableHead className="w-[130px]">Intent</TableHead>
                <TableHead className="w-[64px] text-right">Track</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((sq) => {
                const key = sq.query.toLowerCase();
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{sq.query}</TableCell>
                    <TableCell>
                      <PlatformsCell models={sq.engines} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sq.timesSearched}</TableCell>
                    <TableCell>
                      <SourcedPrompts prompts={sq.sourcedPrompts} />
                    </TableCell>
                    <TableCell>
                      <IntentBadge intent={intents[key]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <TrackCell sq={sq} adding={addingKey === key} onTrack={onTrack} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePager
            page={pager.page}
            totalPages={pager.totalPages}
            total={subQueries.length}
            start={pager.start}
            end={pager.end}
            onPage={pager.setPage}
          />
        </>
      )}
    </div>
  );
}

function FanoutSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-60">
      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 h-8 text-xs"
      />
    </div>
  );
}

function ByPromptView({
  groups,
  intents,
  addingKey,
  pager,
  rangeLabel,
  engine,
  onTrack,
  searchText,
  onSearchChange,
}: {
  groups: PromptGroup[];
  intents: Record<string, string>;
  addingKey: string | null;
  pager: ReturnType<typeof usePagination>;
  rangeLabel: string;
  engine: string | null;
  onTrack: (query: string) => void;
  searchText: string;
  onSearchChange: (text: string) => void;
}) {
  const t = useTranslations('prompts.fanout');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pageRows = groups.slice(pager.start, pager.end);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <FanoutSearchInput
        value={searchText}
        onChange={onSearchChange}
        placeholder="Search prompts…"
      />
      {groups.length === 0 ? (
        searchText ? (
          <NoMatches label="No prompts match your search" />
        ) : engine ? (
          <EngineEmptyState engine={engine} rangeLabel={rangeLabel} />
        ) : (
          <NoMatches label={`No tracked answers in the ${rangeLabel}`} />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28px]" />
                <TableHead>Prompt</TableHead>
                <TableHead className="w-[150px]" title={t('enginesLegend')}>
                  {t('engines')}
                </TableHead>
                <TableHead className="w-[170px] text-right">Answers with fan-out</TableHead>
                <TableHead className="w-[110px] text-right">Sub-queries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(
                ({ prompt, subQueries, totalRuns, runsWithFanout, platforms, fanoutPlatforms }) => {
                  // Nothing fanned out — there is no panel to open, so the row
                  // stays inert rather than expanding into an empty box.
                  const expandable = subQueries.length > 0;
                  const isOpen = expandable && expanded.has(prompt.id);
                  return (
                    <Fragment key={prompt.id}>
                      <TableRow
                        className={cn(expandable && 'cursor-pointer select-none')}
                        onClick={expandable ? () => toggle(prompt.id) : undefined}
                      >
                        <TableCell className="pr-0">
                          {expandable && (
                            // The whole row is clickable for the mouse, but a
                            // <tr> can't carry button semantics without breaking
                            // the table for screen readers — so the toggle itself
                            // is the real, focusable control.
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Hide' : 'Show'} fan-out for "${prompt.text}"`}
                              className="flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle(prompt.id);
                              }}
                            >
                              <ChevronRight
                                className={cn(
                                  'h-4 w-4 text-muted-foreground transition-transform duration-150',
                                  isOpen && 'rotate-90',
                                )}
                              />
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{prompt.text}</TableCell>
                        <TableCell>
                          <PromptEnginesCell
                            platforms={platforms}
                            fanoutPlatforms={fanoutPlatforms}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <FanoutCoverageCell
                            totalRuns={totalRuns}
                            runsWithFanout={runsWithFanout}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className="tabular-nums text-[10px]">
                            {subQueries.length}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={`${prompt.id}-expanded`} className="hover:bg-transparent">
                          <TableCell />
                          <TableCell colSpan={4} className="pb-3 pt-0">
                            <div className="rounded-md border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Sub-query</TableHead>
                                    <TableHead className="w-[160px]">Engine</TableHead>
                                    <TableHead className="w-[120px] text-right">
                                      Times searched
                                    </TableHead>
                                    <TableHead className="w-[130px] pl-6">Intent</TableHead>
                                    <TableHead className="w-[64px] text-right">Track</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {subQueries.map((sq) => {
                                    const key = sq.query.toLowerCase();
                                    return (
                                      <TableRow key={key} className="align-middle">
                                        <TableCell className="align-middle font-medium">
                                          {sq.query}
                                        </TableCell>
                                        <TableCell className="align-middle">
                                          <PlatformsCell models={sq.engines} />
                                        </TableCell>
                                        <TableCell className="align-middle text-right tabular-nums">
                                          {sq.timesSearched}
                                        </TableCell>
                                        <TableCell className="align-middle pl-6">
                                          <IntentBadge intent={intents[key]} />
                                        </TableCell>
                                        <TableCell className="align-middle text-right">
                                          <TrackCell
                                            sq={sq}
                                            adding={addingKey === key}
                                            onTrack={onTrack}
                                          />
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                },
              )}
            </TableBody>
          </Table>
          <TablePager
            page={pager.page}
            totalPages={pager.totalPages}
            total={groups.length}
            start={pager.start}
            end={pager.end}
            onPage={pager.setPage}
          />
        </>
      )}
    </div>
  );
}

function TrackCell({
  sq,
  adding,
  onTrack,
}: {
  sq: FanoutSubQuery;
  adding: boolean;
  onTrack: (query: string) => void;
}) {
  if (sq.tracked) {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-[10px] text-emerald-600 dark:text-emerald-400"
        render={
          sq.trackedPromptId ? (
            <Link href={`/dashboard/prompts/${sq.trackedPromptId}`} />
          ) : undefined
        }
      >
        <Check className="h-3 w-3" />
        Tracked
      </Badge>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={adding}
      onClick={(e) => {
        e.stopPropagation();
        onTrack(sq.query);
      }}
      aria-label={`Track "${sq.query}" as a prompt`}
    >
      {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
    </Button>
  );
}

function SourcedPrompts({ prompts }: { prompts: { id: string; text: string }[] }) {
  if (prompts.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const shown = prompts.slice(0, 2);
  const rest = prompts.slice(2);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((p) => (
        <Link
          key={p.id}
          href={`/dashboard/prompts/${p.id}`}
          title={p.text}
          className="max-w-[160px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {p.text}
        </Link>
      ))}
      {rest.length > 0 && (
        <span
          className="text-[11px] text-muted-foreground"
          title={rest.map((p) => p.text).join('\n')}
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}

/**
 * How much of a prompt's tracked volume actually triggered a live search.
 * Without the denominator "8 sub-queries" is unreadable: 8 out of 10 answers is
 * a prompt the engines research every time; 8 out of 500 is one they don't.
 */
function FanoutCoverageCell({
  totalRuns,
  runsWithFanout,
}: {
  totalRuns: number;
  runsWithFanout: number;
}) {
  const t = useTranslations('prompts.fanout');
  if (totalRuns === 0) return <span className="text-xs text-muted-foreground">—</span>;

  const pct = (runsWithFanout / totalRuns) * 100;
  // Rounding must not overstate the extremes in either direction: a real but
  // tiny signal isn't "0%", and 199/200 isn't the complete coverage "100%"
  // would claim.
  const label = pct > 0 && pct < 1 ? '<1%' : pct > 99 && pct < 100 ? '>99%' : `${Math.round(pct)}%`;

  return (
    <span
      className="text-xs text-muted-foreground tabular-nums"
      title={t('coverageTooltip', { total: totalRuns, withFanout: runsWithFanout })}
    >
      {runsWithFanout} / {totalRuns} · {label}
    </span>
  );
}

function IntentBadge({ intent }: { intent?: string }) {
  // Intents load on-demand (async, cached server-side); show a placeholder
  // until this row's classification resolves.
  if (!intent) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] whitespace-nowrap', INTENT_COLORS[intent] ?? '')}
    >
      {INTENT_LABELS[intent] ?? intent}
    </Badge>
  );
}
