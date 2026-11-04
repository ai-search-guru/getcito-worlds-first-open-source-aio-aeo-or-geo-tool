'use client';

import { useEffect, useState } from 'react';
import { getOpportunityBasket, getQuestionVolume } from '@/lib/actions/content';
import { keptVolume } from '@/lib/content/opportunityMarkdown';
import type { QuestionVolume } from '@/lib/content/questionVolume';
import type { VolumeEstimate } from '@/lib/volumeEstimate';
import type { ContentOpportunity, OpportunityBasket } from '@/types';

/**
 * The opportunity's basket, read once for its card, and its AI volume: its
 * question's, the prompt it is shown with (questionVolume.ts), or the
 * question's volume kept on it if that can't be read. `volume` is undefined
 * while it is read; `prompts` is how many prompts it answers, the question
 * one of them.
 */
export function useOpportunityVolume(opportunity: ContentOpportunity | null) {
  const id = opportunity?.id;
  const brandId = opportunity?.brandId;
  const promptId = opportunity?.promptId;
  const clusterId = opportunity?.clusterId;
  const [basket, setBasket] = useState<{
    id: string;
    basket: OpportunityBasket | null;
    failed: boolean;
  } | null>(null);
  const [live, setLive] = useState<{ key: string; question: QuestionVolume | null } | null>(null);

  useEffect(() => {
    if (!id || !clusterId) return;
    let cancelled = false;
    getOpportunityBasket(id)
      .then((read) => !cancelled && setBasket({ id, basket: read, failed: false }))
      .catch(() => !cancelled && setBasket({ id, basket: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [id, clusterId]);

  const key = id && brandId && promptId ? `${brandId}:${promptId}` : null;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const [brand, prompt] = key.split(':');
    getQuestionVolume(brand, prompt)
      .then((question) => !cancelled && setLive({ key, question }))
      .catch(() => !cancelled && setLive({ key, question: null }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const read = basket?.id === id ? basket : null;
  const question = live?.key === key ? live.question : undefined;
  const kept = opportunity && keptVolume(opportunity);
  const volume: VolumeEstimate | null | undefined = !key
    ? kept
    : question === undefined
      ? undefined
      : (question?.estimate ?? kept);
  // Its prompts: a cluster's members once its basket is in, else those it kept.
  const members = read?.basket
    ? new Set(read.basket.clusters.flatMap((c) => c.prompts.map((p) => p.id))).size
    : (opportunity?.sourceData.prompts?.length ?? 0);
  return {
    basket: read?.basket ?? null,
    basketFailed: read?.failed ?? false,
    volume,
    question: question ?? null,
    prompts: Math.max(1, members),
  };
}
