'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { AgentCard, AgentCardBody, AgentCardFooter, AgentCardHeader, AgentHead } from './AgentCard';
import { StatusPill } from './StatusPill';
import { StepList, type StepRow } from './StepList';

/**
 * A run that stopped on an error (CHAT-mockup-v2 `#s-failed`, CHAT-03 items
 * 16–18): the agent in red, where it stopped and the plain reason, nothing
 * changed; its steps, the failed one with "!" and its reason; and Retry, from
 * the failed step ("Retry step 2", CHAT-23 `run.retryStep`) or the whole run
 * (`run.retry`), through the read-only gate. Never a tool's name or a raw
 * error (CHAT-23 P9).
 */
export function ErrorCard({
  title,
  reason,
  steps,
  failedStep,
  retrying = false,
  onRetry,
  extraAction,
}: {
  /** The run's name: "Merchant feed fix · EU". */
  title: string;
  /** The plain reason: "Google Merchant Center isn't connected · nothing was changed". */
  reason: string;
  steps: StepRow[];
  /** The step it stopped at, from 1; none for an error outside a step. */
  failedStep?: number;
  retrying?: boolean;
  onRetry?: () => void;
  /** A way out beside Retry, such as Connect Google Merchant Center. */
  extraAction?: ReactNode;
}) {
  const t = useTranslations('agentic.errorCard');
  const { guard } = useUpgradeGate();
  const total = steps.length;
  const retry = guard(() => onRetry?.(), { action: t('retryNeedsPlan') });

  return (
    <div data-slot="error-card">
      <AgentHead
        state="failed"
        title={failedStep && total > 0 ? t('stoppedAt', { n: failedStep, total }) : t('stopped')}
        subtitle={reason}
      />
      <AgentCard tone="failed" aria-label={title}>
        <AgentCardHeader title={title} end={<StatusPill state="failed" />} />
        {steps.length > 0 && (
          <AgentCardBody>
            <StepList rows={steps} />
          </AgentCardBody>
        )}
        <AgentCardFooter note={failedStep ? t('retryFrom', { n: failedStep }) : undefined}>
          {extraAction}
          <Button
            data-action={failedStep ? 'run.retryStep' : 'run.retry'}
            disabled={retrying || !onRetry}
            aria-busy={retrying || undefined}
            onClick={retry}
          >
            {retrying && (
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
            )}
            {failedStep ? t('retryStep', { n: failedStep }) : t('retry')}
          </Button>
        </AgentCardFooter>
      </AgentCard>
    </div>
  );
}
