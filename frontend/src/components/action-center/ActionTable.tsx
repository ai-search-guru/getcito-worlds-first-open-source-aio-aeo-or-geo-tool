'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import {
  BarChart3,
  Check,
  CirclePlay,
  Clock,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  Swords,
  Trash2,
  Wrench,
  ShieldCheck,
  Layers,
  Quote,
  RotateCcw,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { RemovedNote } from '@/components/action-center/RemovedNote';
import { RunAgentButton } from '@/components/action-center/RunAgentButton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActionItem } from '@/lib/actions/actionCenter';
import type {
  ActionCategory,
  ActionDismissReason,
  ActionKind,
  ActionStatus,
} from '@/lib/action-center/registry';
import { DismissReasonDialog } from './DismissReasonDialog';
import {
  actionContextTags,
  actionTexts,
  assigneeLabel,
  labelInitials,
} from '@/lib/action-center/display';
import { STALE_AFTER_DAYS, isStale, type PriorityLevel } from '@/lib/action-center/priority';
import { formatRelative } from '@/lib/formatRelative';
import { cn } from '@/lib/utils';
import { useUpgradeGate } from '@/components/context/upgradeGate';

type IconComponent = React.ComponentType<{ className?: string }>;

/** Icons for the original eight kinds; everything else takes its family's. */
const KIND_ICONS: Partial<Record<ActionKind, IconComponent>> = {
  recover_visibility: BarChart3,
  protect_visibility: ShieldCheck,
  expand_platform_visibility: Layers,
  close_citation_gap: Quote,
  capture_ai_traffic: MousePointerClick,
  convert_mentions: MessageSquare,
  fix_low_scores: Wrench,
  close_competitor_gap: Swords,
};

/** What a kind we have no icon for falls back to — every definition belongs
 *  to a family, and the family says enough to orient a reader. */
const CATEGORY_ICONS: Record<ActionCategory, IconComponent> = {
  growth: Sparkles,
  protect: ShieldCheck,
  recover: BarChart3,
  fix: Wrench,
  compete: Swords,
};

/**
 * The icon for an action, whatever kind it turns out to be.
 *
 * A component rather than a lookup helper so the resolution happens in one
 * place: callers that only render it should not have to hold a component in
 * a variable to do so.
 */
export function ActionIcon({
  kind,
  category,
  className,
}: {
  kind: string;
  category: ActionCategory;
  className?: string;
}) {
  const Icon = KIND_ICONS[kind as ActionKind] ?? CATEGORY_ICONS[category] ?? Target;
  return <Icon className={className} />;
}

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  in_progress: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400',
  completed: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  on_hold: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations('actionCenter.actionsPage');
  return (
    <Badge variant="outline" className={ACTION_STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(`status.${status}`)}
    </Badge>
  );
}

/**
 * Stale (00432): New for a month with no one on it. Amber, as On Hold: it
 * waits on someone.
 */
export function StalePill() {
  const t = useTranslations('actionCenter.actionsPage');
  return (
    <Badge
      variant="outline"
      className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      title={t('stale.hint', { days: STALE_AFTER_DAYS })}
    >
      <Clock aria-hidden="true" className="h-3 w-3" />
      {t('stale.pill')}
    </Badge>
  );
}

export const PRIORITY_BADGE: Record<PriorityLevel, string> = {
  critical: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  low: 'border-border bg-muted/50 text-muted-foreground',
};

/**
 * The priority score (AC-006), coloured by its level, and the level's name:
 * "84 High". It stands where Impact used to, since the score weighs impact
 * in. A dash until the server has scored the action.
 */
export function PriorityBadge({
  score,
  level,
  levelClassName,
}: {
  score: number | null;
  level: PriorityLevel | null;
  /** For the level's name: the Content Plan hides it where its table is narrow. */
  levelClassName?: string;
}) {
  const t = useTranslations('actionCenter.actionsPage.priority');
  if (score === null || level === null) {
    return (
      <span className="text-xs text-muted-foreground" title={t('notScored')}>
        —
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant="outline" className={cn('font-semibold tabular-nums', PRIORITY_BADGE[level])}>
        {score}
      </Badge>
      <span className={cn('text-xs', levelClassName)}>{t(`levels.${level}`)}</span>
    </span>
  );
}

export function AssigneeAvatar({ assignee }: { assignee: ActionItem['assignee'] }) {
  const t = useTranslations('actionCenter.actionsPage');
  // New GetCito (AC-ALT2): an action with no one on it is the whole
  // workspace's, until someone takes it.
  if (!assignee) {
    return (
      <span className="text-xs text-muted-foreground" title={t('everyoneTitle')}>
        {t('everyone')}
      </span>
    );
  }
  // Named as the assignee picker names them: by e-mail when there's no name.
  const label = assigneeLabel(assignee);
  const initials = (label && labelInitials(label)) || '?';
  return (
    <Avatar className="h-6 w-6" title={label ?? undefined}>
      {assignee.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt="" />}
      <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The menu column stays at the table's right edge: the table scrolls
 * sideways below about 1,100px, and the menu is what a row is reached for.
 * Opaque, with the row's hover tint, so it covers what scrolls under it.
 */
const MENU_CELL =
  'sticky right-0 z-[5] w-10 bg-card [tr:hover>&]:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]';

/** The statuses the row menu sets, in its order. */
const MENU_STATUSES = [
  { status: 'in_progress', icon: CirclePlay },
  { status: 'completed', icon: Check },
  { status: 'dismissed', icon: X },
] as const;

/**
 * An action's row menu: set it In Progress, Completed or Dismissed, keep a
 * stale one, or delete it, without opening the drawer. The status it already
 * has is off; Delete asks first, and is off for members who can't delete.
 */
function ActionMenu({
  action,
  title,
  canDelete,
  disabled,
  onStatusChange,
  onKeep,
  onDelete,
}: {
  action: ActionItem;
  title: string;
  canDelete: boolean;
  disabled: boolean;
  onStatusChange: (
    action: ActionItem,
    status: ActionStatus,
    reason?: ActionDismissReason | null,
  ) => void;
  onKeep?: (action: ActionItem) => void;
  onDelete: (action: ActionItem) => void;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const [confirming, setConfirming] = useState(false);
  // A read-only workspace (plan not active): a status, and Delete (before its
  // confirm), open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Dismissing asks why first (learning A5).
  const [dismissing, setDismissing] = useState(false);
  return (
    <>
      <DismissReasonDialog
        open={dismissing}
        onOpenChange={setDismissing}
        onChoose={(reason) => onStatusChange(action, 'dismissed', reason)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          aria-label={t('rowMenu.label', { title })}
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {MENU_STATUSES.map(({ status, icon: Icon }) => (
            <DropdownMenuItem
              key={status}
              disabled={action.status === status}
              onClick={guard(
                () =>
                  status === 'dismissed' ? setDismissing(true) : onStatusChange(action, status),
                { action: tActions('changeActionStatus') },
              )}
            >
              <Icon className="h-4 w-4" />
              {t(`rowMenu.${status}`)}
            </DropdownMenuItem>
          ))}
          {onKeep && isStale(action) && (
            <DropdownMenuItem
              onClick={guard(() => onKeep(action), { action: tActions('changeActionStatus') })}
            >
              <RotateCcw className="h-4 w-4" />
              {t('rowMenu.stillRelevant')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            title={canDelete ? undefined : t('rowMenu.deleteNotAllowed')}
            onClick={guard(() => setConfirming(true), { action: tActions('deleteActions') })}
          >
            <Trash2 className="h-4 w-4" />
            {t('rowMenu.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('rowMenu.deleteTitle')}</DialogTitle>
            <DialogDescription>{t('rowMenu.deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('rowMenu.cancel')}</DialogClose>
            <DialogClose render={<Button variant="destructive" onClick={() => onDelete(action)} />}>
              {t('rowMenu.delete')}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ActionTable({
  actions,
  onSelect,
  onStatusChange,
  onKeep,
  onDelete,
  canDelete = false,
  busyIds,
}: {
  actions: ActionItem[];
  onSelect: (action: ActionItem) => void;
  /** With these, each row gets its menu (status changes and Delete). */
  onStatusChange?: (
    action: ActionItem,
    status: ActionStatus,
    reason?: ActionDismissReason | null,
  ) => void;
  /** Still relevant on a stale action's row menu. */
  onKeep?: (action: ActionItem) => void;
  onDelete?: (action: ActionItem) => void;
  canDelete?: boolean;
  /** Actions with a change in flight: their menu waits. */
  busyIds?: Set<string>;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const withMenu = Boolean(onStatusChange && onDelete);
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.action')}</TableHead>
            <TableHead className="text-xs">{t('table.priority')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="text-xs">{t('table.assignee')}</TableHead>
            <TableHead className="text-xs">{t('table.dueDate')}</TableHead>
            <TableHead className="text-xs">{t('table.updated')}</TableHead>
            {withMenu && (
              <TableHead className={MENU_CELL}>
                <span className="sr-only">{t('table.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action) => {
            const texts = actionTexts(action, tTexts);
            const tags = actionContextTags(action, t);
            return (
              <TableRow key={action.id} className="cursor-pointer" onClick={() => onSelect(action)}>
                <TableCell className="max-w-[380px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <ActionIcon
                        kind={action.kind}
                        category={action.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1">
                        <p className="truncate text-sm font-medium">{texts.title}</p>
                        <AskAboutThis
                          reference={{ type: 'task', id: action.id, label: texts.title }}
                          className="shrink-0"
                        />
                        <RunAgentButton
                          action={action}
                          title={texts.title}
                          variant="row"
                          className="shrink-0"
                        />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {tCategories(action.category)}
                        </Badge>
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                        <RemovedNote payload={action.payload ?? {}} />
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <PriorityBadge score={action.priorityScore} level={action.priorityLevel} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <ActionStatusBadge status={action.status} />
                    {isStale(action) && <StalePill />}
                  </div>
                  {action.taskTotal > 0 && (
                    <div className="mt-1.5 w-24">
                      <p className="text-[10px] text-muted-foreground">
                        {t('taskProgress', {
                          completed: action.taskCompleted,
                          total: action.taskTotal,
                        })}
                      </p>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full bg-foreground/60')}
                          style={{
                            width: `${Math.round((action.taskCompleted / action.taskTotal) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <AssigneeAvatar assignee={action.assignee} />
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {action.dueDate
                    ? new Date(`${action.dueDate}T00:00:00Z`).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })
                    : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelative(action.updatedAt, tCommon)}
                </TableCell>
                {withMenu && onStatusChange && onDelete && (
                  // The menu works on the row without opening the drawer.
                  <TableCell className={MENU_CELL} onClick={(e) => e.stopPropagation()}>
                    <ActionMenu
                      action={action}
                      title={texts.title}
                      canDelete={canDelete}
                      disabled={busyIds?.has(action.id) ?? false}
                      onStatusChange={onStatusChange}
                      onKeep={onKeep}
                      onDelete={onDelete}
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
