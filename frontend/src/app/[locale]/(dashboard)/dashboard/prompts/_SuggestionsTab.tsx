'use client';

import { useEffect, useState } from 'react';
import {
  getSuggestionSourceStates,
  type SourceState,
  type SuggestionSourceStates,
} from '@/lib/actions/integrations';
import type { PlanId } from '@/config/plans';
import { DataSourcesPanel } from './_DataSourcesPanel';
import { SuggestionsCard } from './_SuggestionsCard';

/** A mapped source whose first sync has not landed yet. */
export function isAwaitingData(s: SourceState): boolean {
  return s.configured && s.connected && s.mapped && !s.firstDataAt;
}

const POLL_MS = 30_000;
// A first sync takes minutes. Past this, stop polling — a sync that failed
// would otherwise keep the page asking forever; the nightly run retries it.
const MAX_POLLS = 20;

/**
 * The Suggestions tab: the data-sources panel and the suggestion list, fed by
 * one read of which sources are connected and whether their data has landed.
 * While a freshly mapped source is still on its first sync the read repeats,
 * so the list can offer a refresh the moment the data arrives.
 */
export function SuggestionsTab({
  brandId,
  onAccepted,
  onAddTopic,
  planId,
  limitActions,
}: {
  brandId: string;
  onAccepted?: () => void;
  /** "Add a topic" on a brand without one: the page's Topics tab, with Add Topic open. */
  onAddTopic?: () => void;
  planId?: PlanId;
  limitActions?: React.ReactNode;
}) {
  // undefined while loading; null when the read failed — both render nothing
  // source-related, so a status failure never gets in the way of suggestions.
  const [states, setStates] = useState<SuggestionSourceStates | null | undefined>(undefined);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSuggestionSourceStates(brandId)
      .then((s) => !cancelled && setStates(s))
      .catch(() => !cancelled && setStates(null));
    return () => {
      cancelled = true;
    };
  }, [brandId, polls]);

  const awaiting = states ? isAwaitingData(states.gsc) || isAwaitingData(states.ga) : false;

  useEffect(() => {
    if (!awaiting || polls >= MAX_POLLS) return;
    const timer = setTimeout(() => setPolls((n) => n + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [awaiting, polls]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPolls(0);
  }, [brandId]);

  return (
    <>
      <DataSourcesPanel states={states} />
      <SuggestionsCard
        brandId={brandId}
        onAccepted={onAccepted}
        onAddTopic={onAddTopic}
        sourceStates={states ?? null}
        planId={planId}
        limitActions={limitActions}
      />
    </>
  );
}
