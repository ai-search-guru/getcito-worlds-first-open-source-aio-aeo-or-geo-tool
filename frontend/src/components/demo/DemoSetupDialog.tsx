'use client';

import { useSyncExternalStore } from 'react';
import { useNow, useTranslations } from 'next-intl';
import { Check, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { StepSweep } from '@/components/ui/step-sweep';
import { formatNumber } from '@/lib/format';
import {
  DEMO_BRAND_NAME,
  DEMO_PLATFORMS,
  DEMO_SETUP_STEPS,
  SLOW_AFTER_MS,
  setupPosition,
  stepCount,
  stepState,
} from '@/lib/demo/setupSteps';
import { cn } from '@/lib/utils';

/** How often the screen moves on. */
const TICK_MS = 100;

/** Where the setup stands, as useExploreDemo tracks it. */
export interface DemoSetupState {
  /** When the setup was asked (Date.now()): a setup asked ahead is already on its way. */
  startedAt: number;
  /** When it answered, or null while it is awaited. */
  answeredAt: number | null;
  failed: boolean;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

/** Whether the person asked for less motion: the counts then show whole at once. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false,
  );
}

/**
 * The demo brand's tile: its logo, breathing, with the agent card's sweep
 * passing over it while the demo is prepared (Content Editor's working
 * tile). Still with reduced motion.
 */
function DemoTile({ working }: { working: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background',
        working && 'animate-agent-breathe motion-reduce:animate-none',
      )}
    >
      {working && <StepSweep />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG the app ships */}
      <img src="/demo/logos/brewline.svg" alt="" className="h-6 w-6" />
    </span>
  );
}

/**
 * The demo brand being prepared, while "Explore the demo" or "See the demo"
 * waits for it (POST /api/demo): what the server writes, step by step as the
 * Content Agent's card shows its run — the steps done in green with a check,
 * the one under way with a sweep and the agent's dots, its count going up —
 * then the demo opens. Said as preparing, never as anything run for real:
 * the counts are the sample data's own. A failure says so, with Try again.
 */
export function DemoSetupDialog({
  setup,
  onRetry,
  onClose,
}: {
  setup: DemoSetupState | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={setup != null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Mounted while open: its clock starts with it. */}
      {setup && <SetupContent setup={setup} onRetry={onRetry} onClose={onClose} />}
    </Dialog>
  );
}

function SetupContent({
  setup,
  onRetry,
  onClose,
}: {
  setup: DemoSetupState;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('demo.setup');
  const reducedMotion = usePrefersReducedMotion();
  const now = useNow({ updateInterval: TICK_MS }).getTime();
  const elapsed = now - setup.startedAt;
  const answered = setup.answeredAt !== null ? setup.answeredAt - setup.startedAt : null;
  const position = setupPosition(elapsed, answered);
  const done = position >= DEMO_SETUP_STEPS.length;
  const failed = setup.failed;
  const moving = !failed && !done;

  return (
    <DialogContent className="sm:max-w-md" showCloseButton={failed}>
      <DialogHeader className="flex-row items-center gap-3">
        <DemoTile working={moving} />
        <div className="min-w-0 space-y-1">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body', { brand: DEMO_BRAND_NAME })}</DialogDescription>
        </div>
      </DialogHeader>

      <div role="status" className="space-y-2.5 rounded-xl border bg-card px-4 py-3.5">
        <ol className="space-y-2.5">
          {DEMO_SETUP_STEPS.map((step, i) => {
            const { state } = stepState(i, position);
            const active = state === 'now' && !failed;
            const count = stepCount(step, i, position, reducedMotion);
            return (
              <li
                key={step.key}
                data-step={step.key}
                data-state={state}
                aria-current={state === 'now' ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 text-sm',
                  active && 'relative -mx-2 -my-1 overflow-hidden rounded-md px-2 py-1',
                  state === 'next' && 'text-muted-foreground',
                )}
              >
                {active && <StepSweep />}
                {state === 'done' ? (
                  <Check
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                ) : active ? (
                  // No spinning ring: the agent's dots.
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    <LoadingDots />
                  </span>
                ) : (
                  <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                )}
                <span className="min-w-0 flex-1">
                  {t(`steps.${step.key}`, { brand: DEMO_BRAND_NAME, platforms: DEMO_PLATFORMS })}
                </span>
                {/* Hidden from screen readers: it changes ten times a second. */}
                {count !== null && (
                  <span
                    aria-hidden
                    data-slot="count"
                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {formatNumber(count)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {!failed && (
          <p className="border-t pt-2.5 text-xs text-muted-foreground">
            {done ? (
              <span className="font-medium text-foreground">{t('ready')}</span>
            ) : elapsed >= SLOW_AFTER_MS ? (
              t('slow')
            ) : (
              t('usual')
            )}
          </p>
        )}
      </div>

      {failed && (
        <>
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {t('failed')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('close')}
            </Button>
            <Button onClick={onRetry}>{t('retry')}</Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  );
}
