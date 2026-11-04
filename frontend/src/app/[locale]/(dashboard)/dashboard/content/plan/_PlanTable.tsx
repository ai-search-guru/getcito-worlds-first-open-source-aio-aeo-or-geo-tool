'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Bot, EyeOff, MoreHorizontal, Star, User, UserPlus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PriorityBadge } from '@/components/action-center/ActionTable';
import { DRAFT_METHOD_BADGE, DRAFT_STATUS_BADGE } from '@/components/content/DraftBadges';
import { contentEditorPath, isPageType } from '@/lib/content/drafts';
import { platformNames } from '@/lib/content/impact';
import { pagePath } from '@/lib/content/overlap';
import {
  planPriorityLevel,
  type PlanAction,
  type PlanPeriod,
  type PlanRow,
  type PlanScorePart,
  type PlanWhy,
} from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Create blue, Optimize amber (as the drafts' method), Protect green. */
export const PLAN_ACTION_BADGE: Record<PlanAction, string> = {
  create: DRAFT_METHOD_BADGE.create,
  optimize: DRAFT_METHOD_BADGE.optimize,
  protect: DRAFT_STATUS_BADGE.ready,
};

/**
 * The Plan's priority list (CE-014): rank, the Priority Score (what the
 * list is ranked by, with how it was worked out), the page (a new one, or
 * the brand's own), the action, why for the period with where it comes from,
 * who is on it, the button that starts it — or opens its draft — and a row
 * menu: assign it to a teammate, and for admins and managers, mark it as a
 * priority or hide it.
 */
export function PlanTable({
  rows,
  days,
  canManage,
  onStart,
  onAssign,
  onPriority,
  onHide,
}: {
  rows: PlanRow[];
  days: PlanPeriod;
  canManage: boolean;
  onStart: (row: PlanRow) => void;
  onAssign: (row: PlanRow) => void;
  onPriority: (row: PlanRow, priority: boolean) => void;
  onHide: (row: PlanRow) => void;
}) {
  const t = useTranslations('contentEditor.plan');
  const tTypes = useTranslations('contentEditor.pageTypes');

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-6">#</TableHead>
          {/* Narrow windows: two lines, and the score without its level's name. */}
          <TableHead className="w-16 whitespace-normal leading-tight xl:w-auto xl:whitespace-nowrap">
            {t('columns.score')}
          </TableHead>
          <TableHead>{t('columns.page')}</TableHead>
          <TableHead>{t('columns.action')}</TableHead>
          <TableHead>{t('columns.why', { days })}</TableHead>
          {/* Wide windows only: the row's button says the same once a draft exists. */}
          <TableHead className="hidden xl:table-cell">{t('columns.who')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('columns.start')}</span>
          </TableHead>
          <TableHead className="w-8 pl-0 pr-3">
            <span className="sr-only">{t('columns.menu')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={row.key}>
            <TableCell className="pl-6 tabular-nums text-muted-foreground">{i + 1}</TableCell>
            <TableCell>
              <ScoreBadge row={row} />
            </TableCell>
            {/* Narrower below xl, to leave room for the Priority Score at 1024 px. */}
            <TableCell className="max-w-[200px] xl:max-w-[250px]">
              <p className="flex min-w-0 items-center gap-1.5 font-medium">
                <span className="truncate" title={row.title}>
                  {row.title}
                </span>
                {row.priority && (
                  <Badge variant="outline" className="shrink-0 gap-1 font-normal">
                    <Star aria-hidden className="h-3 w-3" />
                    {t('priority')}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {isPageType(row.pageType) && (
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {tTypes(row.pageType)}
                  </Badge>
                )}
                <span className="truncate" title={row.page ?? undefined}>
                  {row.page ? pagePath(row.page) : t('newPage')}
                </span>
              </p>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={PLAN_ACTION_BADGE[row.action]}>
                {t(`actions.${row.action}`)}
              </Badge>
            </TableCell>
            <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal">
              <WhyText why={row.why} />
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t(`sources.${row.source}`)}
              </span>
            </TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">
              {row.draft?.assignee ? (
                <span className="inline-flex items-center gap-1.5">
                  <User aria-hidden className="h-3.5 w-3.5" />
                  {row.draft.assignee.name}
                </span>
              ) : row.draft ? (
                <span className="inline-flex items-center gap-1.5">
                  {row.draft.author === 'agent' ? (
                    <Bot aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <User aria-hidden className="h-3.5 w-3.5" />
                  )}
                  {row.draft.author === 'agent'
                    ? t('who.agent')
                    : row.draft.isMine
                      ? t('who.you')
                      : t('who.team')}
                </span>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="text-right">
              {row.draft ? (
                <Link
                  href={contentEditorPath(row.draft.id)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  {t('openDraft')}
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant={row.action === 'protect' ? 'outline' : 'default'}
                  onClick={() => onStart(row)}
                >
                  {t(`start.${row.action}`)}
                </Button>
              )}
            </TableCell>
            <TableCell className="pl-0 pr-3">
              <RowMenu
                row={row}
                canManage={canManage}
                onAssign={onAssign}
                onPriority={onPriority}
                onHide={onHide}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RowMenu({
  row,
  canManage,
  onAssign,
  onPriority,
  onHide,
}: {
  row: PlanRow;
  canManage: boolean;
  onAssign: (row: PlanRow) => void;
  onPriority: (row: PlanRow, priority: boolean) => void;
  onHide: (row: PlanRow) => void;
}) {
  const t = useTranslations('contentEditor.plan.rowMenu');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        aria-label={t('label', { title: row.title })}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => onAssign(row)}>
          <UserPlus className="h-4 w-4" />
          {t('assign')}
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={() => onPriority(row, !row.priority)}>
              <Star className="h-4 w-4" />
              {row.priority ? t('unmarkPriority') : t('markPriority')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onHide(row)}>
              <EyeOff className="h-4 w-4" />
              {t('hide')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The row's Priority Score, coloured by its level in the Action Center's
 * colours but at the Plan's own cut-offs (planPriorityLevel), and on hover or
 * focus what it is made of.
 */
function ScoreBadge({ row }: { row: PlanRow }) {
  const t = useTranslations('contentEditor.plan.score');
  const score = Math.round(row.score);
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          <button
            type="button"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={t('label', { score })}
          />
        }
      >
        <PriorityBadge
          score={score}
          level={planPriorityLevel(score)}
          levelClassName="hidden xl:inline"
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p className="font-medium">{t('title')}</p>
        {row.scoreParts.map((part) => (
          <p key={part.kind}>
            <ScorePartText part={part} />
          </p>
        ))}
        <p className="opacity-80">{t('total', { score })}</p>
        {row.priority && <p className="opacity-80">{t('marked')}</p>}
        <p className="opacity-80">{t('planOnly')}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** One factor of the score, and the points it gives out of its weight. */
function ScorePartText({ part }: { part: PlanScorePart }) {
  const t = useTranslations('contentEditor.plan.score');
  const text = (() => {
    switch (part.kind) {
      case 'severity':
        return part.reason === 'drop'
          ? t('severity.drop', { pct: part.pct, lost: part.lost })
          : t(`severity.${part.reason}`);
      case 'opportunity':
        return part.score === null ? t('opportunityNone') : t('opportunity', { score: part.score });
      case 'pageValue':
        return part.reason !== 'visits'
          ? t(`pageValue.${part.reason}`)
          : part.conversions === null
            ? t('pageValue.visits', { visits: part.visits })
            : t('pageValue.visitsConversions', {
                visits: part.visits,
                conversions: part.conversions,
              });
      case 'citations':
        return t('citations', { citations: part.citations });
    }
  })();
  return t('points', { text, points: formatNumber(part.points), max: part.max });
}

function WhyText({ why }: { why: PlanWhy }) {
  const t = useTranslations('contentEditor.plan.why');
  const format = useFormatter();
  switch (why.kind) {
    case 'competitors':
      return (
        <span>
          {why.visibility === null
            ? t('competitors', { names: format.list(why.names) })
            : t('competitorsVisibility', {
                names: format.list(why.names),
                visibility: formatNumber(why.visibility),
              })}
        </span>
      );
    case 'opportunity':
      return <span>{t('opportunity', { count: why.prompts })}</span>;
    case 'citationsDown':
      return (
        <span>
          <span className="font-medium text-red-600 dark:text-red-400">
            {t('citationsDown', { pct: why.pct })}
          </span>
          {why.platforms.length > 0 &&
            ` ${t('on', { platforms: format.list(platformNames(why.platforms)) })}`}
        </span>
      );
    case 'top':
      return (
        <span>
          {t('top', {
            citations: why.citations,
            citationsText: formatNumber(why.citations),
            visits: why.aiVisits,
            visitsText: formatNumber(why.aiVisits),
          })}
        </span>
      );
  }
}
