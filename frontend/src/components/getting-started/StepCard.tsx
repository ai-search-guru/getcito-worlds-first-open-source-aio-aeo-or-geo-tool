'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ExternalLink, Play, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ACTION_STATUS_BADGE } from '@/components/action-center/ActionTable';
import { skipGettingStartedStep } from '@/lib/actions/gettingStarted';
import type { TeamMember } from '@/lib/actions/team';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { FirstRunEmptyState } from '@/components/first-run/FirstRunEmptyState';
import type { FirstRun } from '@/hooks/useFirstRun';
import {
  GETTING_STARTED_CHIP,
  StepStatusBadge,
  WorkspaceAvatars,
  arrivingStep,
  readyWhenKey,
} from './GettingStartedTable';

const AMBER_NOTE = ACTION_STATUS_BADGE.on_hold;

/**
 * The step videos' place under "How to do this". Off until the videos are
 * recorded: the numbered steps say how meanwhile.
 */
const SHOW_STEP_VIDEOS = false;

/**
 * A Getting started step's card (AC-ALT2 §6), on the right of the Actions
 * page: why the step matters, how to do it, and when it counts as done. Its
 * button opens the step's page in a new tab; an optional step can be skipped
 * after a last-chance question. Not modal: the list stays usable beside it
 * and makes room for it on wide screens. While the brand's first run brings
 * a step's data, the card says how far it is instead of opening a page that
 * is still empty.
 */
export function GettingStartedStepCard({
  brandId,
  step,
  members,
  canManage,
  onClose,
  onChanged,
  onReady,
  firstRun,
}: {
  brandId: string;
  step: GettingStartedStep;
  members: TeamMember[];
  /** Admins and managers: only they skip a step (00196). */
  canManage: boolean;
  onClose: () => void;
  /** A step was skipped: read the steps again. */
  onChanged: () => void;
  /** The last step's button: on to the actions. */
  onReady: () => void;
  /** The brand's first tracking run while it goes on. */
  firstRun: FirstRun | null;
}) {
  const t = useTranslations('actionCenter.gettingStarted');
  const [opened, setOpened] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // A read-only workspace (plan not active): Skip opens the upgrade dialog
  // instead of its question; opening the step's page stays.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  // Another step: its own "opened" note.
  useEffect(() => setOpened(false), [step.key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape belongs to a dialog open over the page (this card's Skip
      // question, or another), not to the card under it.
      const dialogOpen = document.querySelector('[role="dialog"]:not([aria-modal="false"])');
      if (event.key === 'Escape' && !confirmingSkip && !dialogOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmingSkip]);

  const text = (key: string) => t(`steps.${step.key}.${key}`);
  const list = (key: 'why' | 'how') => t.raw(`steps.${step.key}.${key}`) as string[];
  const when = t(`readyWhen.${readyWhenKey(step)}`);

  const openPage = () => {
    window.open(step.href, '_blank', 'noopener');
    setOpened(true);
  };

  const skip = async () => {
    setSkipping(true);
    try {
      await skipGettingStartedStep(brandId, step.key);
      toast.success(t('skipDialog.skipped'));
      onChanged();
    } catch {
      toast.error(t('skipDialog.failed'));
    } finally {
      setSkipping(false);
    }
  };

  const footer = () => {
    if (step.key === 'ready' && step.state !== 'waiting') {
      return <Button onClick={onReady}>{text('open')}</Button>;
    }
    if (firstRun && arrivingStep(step, firstRun)) {
      return <FirstRunEmptyState run={firstRun} className="w-full" />;
    }
    if (step.state === 'done') {
      return (
        <span className="flex items-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
          <Check className="h-4 w-4" />
          {t('panel.doneAuto')}
        </span>
      );
    }
    if (step.state === 'waiting') {
      return <span className="text-sm text-muted-foreground">{t('opensWhenReady', { when })}</span>;
    }
    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button onClick={openPage}>
            {text('open')}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          {step.optional && step.state !== 'skipped' && canManage && (
            <Button
              variant="ghost"
              disabled={skipping}
              onClick={guard(() => setConfirmingSkip(true), { action: tActions('skipSteps') })}
              className="text-muted-foreground"
            >
              {t('panel.skip')}
            </Button>
          )}
        </div>
        {opened && <p className="text-xs text-muted-foreground">{t('panel.inNewTab')}</p>}
      </div>
    );
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="getting-started-step-title"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-card shadow-lg sm:w-[440px]"
    >
      <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('text-[10px]', GETTING_STARTED_CHIP)}>
            {t('category')}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {t(`stages.${step.stage}`)}
          </Badge>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('panel.close')} onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StepStatusBadge state={step.state} />
            {step.optional && (
              <Badge variant="outline" className={cn('text-[10px]', AMBER_NOTE)}>
                {t('panel.optionalRecommended')}
              </Badge>
            )}
          </div>
          <h2 id="getting-started-step-title" className="mt-2.5 text-lg font-semibold">
            {text('title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{text('summary')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <WorkspaceAvatars members={members} />
            <span>{t('everyone')}</span>
            <span>· {t('panel.ready', { when })}</span>
          </div>
        </div>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('panel.why')}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {list('why').map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('panel.how')}
          </h3>
          {/* The video's place, 16:9, once the videos are recorded. */}
          {SHOW_STEP_VIDEOS && (
            <div className="mt-2 flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 text-muted-foreground">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border bg-card">
                <Play className="h-4 w-4" />
              </span>
              <span className="text-xs font-medium">{t('panel.videosSoon')}</span>
            </div>
          )}
          <ol
            className={cn(
              'list-decimal space-y-1 pl-5 text-sm',
              SHOW_STEP_VIDEOS ? 'mt-3' : 'mt-2',
            )}
          >
            {list('how').map((how) => (
              <li key={how}>{how}</li>
            ))}
          </ol>
        </section>

        {step.state === 'skipped' && (
          <p className={cn('rounded-md border px-3 py-2 text-xs', AMBER_NOTE)}>
            {t('panel.skippedNote')}
          </p>
        )}

        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            {t('panel.doneWhen', { condition: text('doneWhen') })}
            {step.progress && (
              <span className="font-semibold tabular-nums">
                {' · '}
                {step.progress.value}/{step.progress.target}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="flex min-h-14 items-center border-t px-5 py-3">{footer()}</div>

      {/* Only the optional steps (Search Console, Analytics) have a name to ask about. */}
      {step.optional && (
        <Dialog open={confirmingSkip} onOpenChange={setConfirmingSkip}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('skipDialog.title', { name: text('name') })}</DialogTitle>
              <DialogDescription>{t('skipDialog.body')}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>{t('skipDialog.lessAccurate')}</li>
              <li>{t('skipDialog.noClicks')}</li>
            </ul>
            <p className="text-xs text-muted-foreground">{t('skipDialog.later')}</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" onClick={() => void skip()} />}>
                {t('skipDialog.skip')}
              </DialogClose>
              <DialogClose render={<Button onClick={openPage} />}>
                {t('skipDialog.connect')}
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
}
