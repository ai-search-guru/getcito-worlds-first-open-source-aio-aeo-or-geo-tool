'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, MousePointerClick, SquareCheckBig, Unlock, Zap } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PLANS } from '@/config/plans';
import type { ChatAccess } from '@/lib/actions/chatAccess';
import { approvalMark, type ApprovalMark, type CapabilityArea } from '@/lib/chat/access';
import type { ToolCatalogEntry } from '@/lib/chat/registry/tools';
import { cn } from '@/lib/utils';
import { YourPlanCard } from './PlanCard';

const MARK_ICON: Record<ApprovalMark, typeof Unlock> = {
  none: Unlock,
  card: SquareCheckBig,
  auto: Zap,
  click: MousePointerClick,
};

const FILTERS = ['all', 'write', 'execute', 'read'] as const;
type Filter = (typeof FILTERS)[number];

/** "What Chat can do": the registry by area, searchable, with the plan card on top. */
export function CapabilitiesView({
  access,
  areas,
}: {
  access: ChatAccess;
  areas: CapabilityArea[];
}) {
  const t = useTranslations('chatAccess.capabilities');
  const tAccess = useTranslations('chatAccess');
  const tTools = useTranslations('chatTools');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const toolName = (entry: ToolCatalogEntry) => tTools(`${entry.key}.name`);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return areas.filter((area) => {
      if (filter === 'write' && area.write.length === 0) return false;
      if (filter === 'execute' && area.execute.length === 0) return false;
      if (filter === 'read' && area.write.length + area.execute.length > 0) return false;
      if (!q) return true;
      const words = [
        t(`areaNames.${area.area}`),
        ...[...area.read, ...area.write, ...area.execute].map(toolName),
      ];
      return words.some((word) => word.toLowerCase().includes(q));
    });
    // toolName and t read the same messages each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, filter, query]);

  const entries = (list: ToolCatalogEntry[]) =>
    list.length === 0 ? (
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
    ) : (
      <ul className="space-y-1">
        {list.map((entry) => {
          const mark = approvalMark(entry);
          const Icon = MARK_ICON[mark];
          const lock = access.toolLocks[entry.key];
          return (
            <li key={entry.key} className="flex items-start gap-1.5">
              {entry.class !== 'read' && (
                <Icon
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-label={t(`legend.${mark}`)}
                />
              )}
              <span>
                {toolName(entry)}
                {lock && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" aria-hidden />
                    {t('locked', { plan: PLANS[lock].name })}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <Badge variant="secondary" className="tabular-nums">
            {t('areas', { count: areas.length })}
          </Badge>
        </div>
        <p className="text-muted-foreground">{t('lead')}</p>
      </div>

      {access.plan && <YourPlanCard plan={access.plan} isAdmin={access.role === 'admin'} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-8 w-64 max-w-full"
        />
        {FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              filter === id
                ? 'border-foreground bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`filters.${id}`)}
          </button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {(Object.keys(MARK_ICON) as ApprovalMark[]).map((mark) => {
            const Icon = MARK_ICON[mark];
            return (
              <span key={mark} className="inline-flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(`legend.${mark}`)}
              </span>
            );
          })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.area')}</TableHead>
              <TableHead>{t('columns.read')}</TableHead>
              <TableHead>{t('columns.write')}</TableHead>
              <TableHead>{t('columns.execute')}</TableHead>
              <TableHead>{t('columns.who')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((area) => (
                <TableRow key={area.area} className="align-top">
                  <TableCell className="font-medium">{t(`areaNames.${area.area}`)}</TableCell>
                  <TableCell className="whitespace-normal">{entries(area.read)}</TableCell>
                  <TableCell className="whitespace-normal">{entries(area.write)}</TableCell>
                  <TableCell className="whitespace-normal">{entries(area.execute)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {area.writers.length === 0
                      ? t('readAll')
                      : area.writers.map((role) => tAccess(`roleNames.${role}`)).join(' · ')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** The page when its facts couldn't be read: plain words and Retry, never the error itself. */
export function CapabilitiesUnavailable() {
  const t = useTranslations('chatAccess.capabilities');
  const router = useRouter();
  return (
    <div role="status" className="space-y-2 text-sm text-muted-foreground">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
      <p>{t('loadError')}</p>
      <Button size="sm" variant="outline" onClick={() => router.refresh()}>
        {t('retry')}
      </Button>
    </div>
  );
}
