'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Check,
  Code,
  FileText,
  Flag,
  Gauge,
  Globe,
  LineChart,
  MessageCircleMore,
  Plug,
  Quote,
  Sparkles,
  Tag,
  Trophy,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ACTION_STATUS_BADGE } from '@/components/action-center/ActionTable';
import { labelInitials, memberLabel } from '@/lib/action-center/display';
import { formatRelative } from '@/lib/formatRelative';
import type { TeamMember } from '@/lib/actions/team';
import type { FirstRun } from '@/hooks/useFirstRun';
import {
  firstRunOrder,
  needsFirstAnswers,
  readyNow,
  type GettingStartedState,
  type GettingStartedStep,
  type GettingStartedStepKey,
} from '@/lib/getting-started/steps';
import { cn } from '@/lib/utils';

const STEP_ICONS: Record<GettingStartedStepKey, React.ComponentType<{ className?: string }>> = {
  kpis: Flag,
  competitors: Trophy,
  topics: Tag,
  prompts: Globe,
  gsc: Plug,
  ga: Plug,
  snippet: Code,
  visibility: BarChart3,
  answers: Globe,
  data_prompts: Globe,
  mentions: MessageCircleMore,
  citations: Quote,
  traffic: LineChart,
  pick_content: FileText,
  create_content: FileText,
  optimize_page: Gauge,
  ready: Sparkles,
};

/** The live action statuses' colours: New, Done (Completed), Skipped (On Hold). */
export const STEP_STATUS_BADGE: Record<GettingStartedState, string> = {
  new: ACTION_STATUS_BADGE.new,
  done: ACTION_STATUS_BADGE.completed,
  waiting: ACTION_STATUS_BADGE.dismissed,
  skipped: ACTION_STATUS_BADGE.on_hold,
};

/** Getting started's chip, in the New status's blue. */
export const GETTING_STARTED_CHIP =
  'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400';
const OPTIONAL_CHIP = ACTION_STATUS_BADGE.on_hold;
const READY_NOW_CHIP = ACTION_STATUS_BADGE.in_progress;

/** When a step's data is ready, as the Ready column says it. */
export function readyWhenKey(step: GettingStartedStep) {
  return step.key === 'data_prompts' ? 'dataPrompts' : step.stage;
}

/**
 * A step whose page the brand's first run is filling right now: its card
 * says how far the run is, instead of opening a page that is still empty.
 * The act steps wait for the suggestions that come after it, as before.
 */
export function arrivingStep(step: GettingStartedStep, firstRun: FirstRun | null): boolean {
  return firstRun !== null && needsFirstAnswers(step) && step.state !== 'done';
}

export function StepStatusBadge({ state }: { state: GettingStartedState }) {
  const t = useTranslations('actionCenter.gettingStarted');
  return (
    <Badge variant="outline" className={STEP_STATUS_BADGE[state]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(`status.${state}`)}
    </Badge>
  );
}

/** Getting started is everyone's: the workspace's first members, then a count. */
export function WorkspaceAvatars({ members }: { members: TeamMember[] }) {
  const t = useTranslations('actionCenter.gettingStarted');
  if (members.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = members.slice(0, 3);
  return (
    <div className="flex items-center" title={t('everyone')}>
      {shown.map((member) => (
        <Avatar key={member.userId} className="-ml-1.5 h-6 w-6 ring-2 ring-card first:ml-0">
          {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
          <AvatarFallback className="text-[10px]">
            {labelInitials(memberLabel(member)) || '?'}
          </AvatarFallback>
        </Avatar>
      ))}
      {members.length > shown.length && (
        <span className="ml-1 text-[10px] text-muted-foreground">
          +{members.length - shown.length}
        </span>
      )}
    </div>
  );
}

export function GettingStartedTable({
  steps,
  members,
  onSelect,
  selectedKey,
  showNote,
  firstRun,
}: {
  steps: GettingStartedStep[];
  members: TeamMember[];
  onSelect: (step: GettingStartedStep) => void;
  /** The step whose card is open. */
  selectedKey: string | null;
  /** Says where the AI actions will appear, while there are none yet. */
  showNote: boolean;
  /**
   * The brand's first tracking run while it goes on: the steps ready now
   * come first, marked, and the ones it brings the data for say so.
   */
  firstRun: FirstRun | null;
}) {
  const t = useTranslations('actionCenter.gettingStarted');
  const tPage = useTranslations('actionCenter.actionsPage');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{tPage('table.action')}</TableHead>
            <TableHead className="text-xs">{t('table.stage')}</TableHead>
            <TableHead className="text-xs">{tPage('table.status')}</TableHead>
            <TableHead className="text-xs">{tPage('table.assignee')}</TableHead>
            <TableHead className="text-xs">{t('table.ready')}</TableHead>
            <TableHead className="text-xs">{tPage('table.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(firstRun ? firstRunOrder(steps) : steps).map((step) => {
            const Icon = STEP_ICONS[step.key];
            const arriving = arrivingStep(step, firstRun);
            // A step waiting for the first run's data opens its card, which says how far it is.
            const waiting = step.state === 'waiting' && !arriving;
            const done = step.state === 'done';
            return (
              <TableRow
                key={step.key}
                aria-selected={step.key === selectedKey}
                className={cn(
                  waiting ? 'cursor-default' : 'cursor-pointer',
                  step.key === selectedKey &&
                    'bg-muted/50 shadow-[inset_3px_0_0_var(--foreground)]',
                )}
                onClick={() => onSelect(step)}
              >
                <TableCell className="max-w-[380px]">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40',
                        done && ACTION_STATUS_BADGE.completed,
                      )}
                    >
                      {done ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p
                        className={cn(
                          'truncate text-sm font-medium',
                          (step.state === 'waiting' || done) && 'text-muted-foreground',
                        )}
                      >
                        {t(`steps.${step.key}.title`)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t(`steps.${step.key}.summary`)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', GETTING_STARTED_CHIP)}
                        >
                          {t('category')}
                        </Badge>
                        {firstRun && readyNow(step) && (
                          <Badge variant="outline" className={cn('text-[10px]', READY_NOW_CHIP)}>
                            {t('readyNow')}
                          </Badge>
                        )}
                        {step.optional && (
                          <Badge variant="outline" className={cn('text-[10px]', OPTIONAL_CHIP)}>
                            {t('optional')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t(`stages.${step.stage}`)}
                </TableCell>
                <TableCell>
                  <StepStatusBadge state={step.state} />
                  {step.progress && (
                    <div className="mt-1.5 w-24">
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        {step.progress.value}/{step.progress.target}
                      </p>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground/60"
                          style={{
                            width: `${Math.round((step.progress.value / step.progress.target) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <WorkspaceAvatars members={members} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {arriving ? t('readyWhen.arriving') : t(`readyWhen.${readyWhenKey(step)}`)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {step.updatedAt ? formatRelative(step.updatedAt, tCommon) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {showNote && (
        <div className="flex items-center gap-3 border-t border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>{t('note')}</span>
        </div>
      )}
    </div>
  );
}
