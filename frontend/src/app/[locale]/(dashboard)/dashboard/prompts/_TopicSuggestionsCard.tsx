'use client';

import { useEffect, useState, useCallback, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Plus,
  X,
  RefreshCw,
  Loader2,
  Info,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getTopicSuggestions,
  refreshTopicSuggestions,
  acceptTopicSuggestion,
  dismissTopicSuggestion,
  type TopicSuggestion,
} from '@/lib/actions/topicSuggestions';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { readWithOneRetry, type ReadFailure } from '@/lib/apiFailure';
import { SuggestionsLoadError } from './_SuggestionsLoadError';

interface Props {
  brandId: string;
  /** admin/manager only — read-only card when false (#463). */
  canManage: boolean;
  onAccepted?: () => void;
}

/** localStorage key remembering whether the card is expanded across visits. */
const EXPANDED_KEY = 'aeo:topic-suggestions-expanded';

export function TopicSuggestionsCard({ brandId, canManage, onAccepted }: Props) {
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ReadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Collapsed by default so the card is a one-line strip and the leaderboard
  // stays above the fold; the user's last choice is remembered. Starts false
  // on both server and client (no hydration mismatch), then the effect below
  // restores the stored preference.
  const [expanded, setExpanded] = useState(false);
  const [, startTransition] = useTransition();
  // A read-only workspace (plan not active): generating, adding and
  // dismissing open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tManagers = useTranslations('managersOnly');

  useEffect(() => {
    try {
      if (localStorage.getItem(EXPANDED_KEY) === '1') setExpanded(true);
    } catch {
      // Storage unavailable (private mode) — stay collapsed.
    }
    if (window.location.hash === '#topic-opportunities') {
      // Deep links mean "show me the suggestions" — expand (without touching
      // the stored preference) and scroll the card into view.
      setExpanded(true);
      document.getElementById('topic-opportunities')?.scrollIntoView();
    }
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Once more by itself when the API didn't answer, as while it restarts.
    const read = await readWithOneRetry(() => getTopicSuggestions(brandId));
    if (read.ok) {
      setSuggestions(read.suggestions);
      setLoaded(true);
    } else {
      setError(read);
    }
    setLoading(false);
  }, [brandId]);

  // Fetch ONLY once the card is actually expanded — never on page load. The
  // collapsed strip must not fire a server action (#313: a mount-time call
  // would sit first in Next's serialized action queue and stall the
  // leaderboard's own data fetch behind it). Generation is a separate,
  // explicit button — this fetch only reads persisted rows.
  useEffect(() => {
    setLoaded(false);
    setSuggestions([]);
    setError(null);
  }, [brandId]);

  useEffect(() => {
    if (expanded && !loaded && !loading) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, loaded, brandId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshTopicSuggestions(brandId);
      setSuggestions(fresh);
      setLoaded(true);
      setError(null);
      toast.success('Topic suggestions refreshed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAccept = (s: TopicSuggestion) => {
    setPendingId(s.id);
    startTransition(async () => {
      try {
        await acceptTopicSuggestion(s.id);
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
        onAccepted?.();
        toast.success(`"${s.name}" added to your topics`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setPendingId(null);
      }
    });
  };

  const handleDismiss = (s: TopicSuggestion) => {
    setPendingId(s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    dismissTopicSuggestion(s.id)
      .catch(() => {
        // Roll back on failure
        setSuggestions((prev) => [...prev, s]);
        toast.error('Failed to dismiss');
      })
      .finally(() => setPendingId(null));
  };

  return (
    <Card id="topic-opportunities">
      <CardHeader className={expanded ? 'pb-3' : 'py-4'}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            className="flex items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Topic Suggestions</CardTitle>
            <Info
              className="h-3.5 w-3.5 text-muted-foreground cursor-help"
              aria-label="AI-generated topic ideas for your brand. Topics you already track and dismissed ideas never reappear."
            >
              <title>
                AI-generated topic ideas for your brand. Topics you already track and dismissed
                ideas never reappear.
              </title>
            </Info>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : loaded && suggestions.length > 0 ? (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {suggestions.length}
              </Badge>
            ) : loaded ? (
              !expanded && (
                <span className="text-xs text-muted-foreground">no new ideas — expand</span>
              )
            ) : (
              !expanded && (
                <span className="text-xs text-muted-foreground">expand for AI topic ideas</span>
              )
            )}
          </button>
          {expanded && canManage && (
            <Button
              onClick={guard(handleRefresh, { action: tActions('suggestTopics') })}
              disabled={refreshing}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              {refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {refreshing ? 'Generating…' : 'Refresh'}
            </Button>
          )}
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <SuggestionsLoadError failure={error} onRetry={load} />
          ) : suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium mb-1">No suggestions right now</p>
              <p className="text-xs text-muted-foreground mb-3 max-w-sm">
                {canManage
                  ? 'Generate AI topic ideas tailored to your brand and industry. Topics you already track are excluded automatically.'
                  : 'No topic suggestions have been generated for this brand yet.'}
              </p>
              {canManage ? (
                <Button
                  onClick={guard(handleRefresh, { action: tActions('suggestTopics') })}
                  disabled={refreshing}
                  size="sm"
                  className="gap-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Generate Suggestions
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">{tManagers('suggestTopics')}</p>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {suggestions.map((s) => {
                const busy = pendingId === s.id;
                return (
                  <li
                    key={s.id}
                    className="group flex items-center gap-3 rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium leading-snug">{s.name}</p>
                      {s.reason && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          onClick={guard(() => handleAccept(s), {
                            action: tActions('addTopics'),
                          })}
                          disabled={busy}
                          title="Add to tracked topics"
                          aria-label="Add to tracked topics"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={guard(() => handleDismiss(s), {
                            action: tActions('dismissSuggestions'),
                          })}
                          disabled={busy}
                          title="Dismiss suggestion"
                          aria-label="Dismiss suggestion"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}
