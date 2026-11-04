'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Columns3, GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  removePromptTableView,
  savePromptTableView,
  type PromptTableViews,
} from '@/lib/actions/promptTableViews';
import {
  MAX_LOCATION_COLUMNS,
  addLocationColumn,
  effectiveView,
  isLocationColumn,
  moveColumn,
  parseLocationColumn,
  removeColumn,
  sameView,
  toggleColumn,
  visibleColumns,
  type PromptColumnsView,
  type TableColumnId,
} from '@/lib/promptTableColumns';
import { LOCATION_METRICS, type LocationMetric } from '@/lib/promptLocationMatrix';
import { regionLabel } from '@/lib/region';
import { cn } from '@/lib/utils';

/** Changes are saved this long after the last one, so a few clicks save once. */
const SAVE_AFTER_MS = 600;

/**
 * The Tracked Prompts table's Columns panel (PROMPT-015a): show, hide and
 * order the columns, saved for the person; an admin or manager can share
 * theirs with everyone on the brand. Reset goes back to the brand's shared
 * view, or the default. A metric in one of the brand's locations can be
 * added as a column (PROMPT-015b).
 */
export function ColumnsPanel({
  brandId,
  brandName,
  canManage,
  views,
  onViewsChange,
  locations,
}: {
  brandId: string;
  brandName: string;
  canManage: boolean;
  views: PromptTableViews;
  onViewsChange: (views: PromptTableViews) => void;
  /** The locations the brand's prompts track, for location columns. */
  locations: string[];
}) {
  const t = useTranslations('prompts.columns.picker');
  const tLabels = useTranslations('prompts.columns.labels');
  const tMetrics = useTranslations('prompts.locations.metrics');
  const view = effectiveView(views.mine, views.brand);
  // Linked to the brand's view only once an admin or manager shared their
  // own: someone just looking at the brand's view changes theirs alone.
  const shared =
    canManage && views.mine !== null && views.brand !== null && sameView(views.brand, views.mine);
  const [dragging, setDragging] = useState<TableColumnId | null>(null);
  const [newMetric, setNewMetric] = useState<LocationMetric>('visibility');
  const [newRegion, setNewRegion] = useState('');
  const region = locations.includes(newRegion) ? newRegion : (locations[0] ?? '');
  const locationCount = view.order.filter(isLocationColumn).length;
  const labelOf = (id: TableColumnId) => {
    const loc = parseLocationColumn(id);
    return loc ? `${tMetrics(loc.metric)} · ${regionLabel(loc.region)}` : tLabels(id);
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = (result: Awaited<ReturnType<typeof savePromptTableView>>) => {
    if (!result.ok) toast.error(result.error === 'forbidden' ? t('forbidden') : t('failed'));
  };

  // Shown at once; saved for the person, and for the brand while it's shared.
  const change = (next: PromptColumnsView) => {
    onViewsChange({ mine: next, brand: shared ? next : views.brand });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void savePromptTableView(brandId, next, 'mine').then(report);
      if (shared) void savePromptTableView(brandId, next, 'brand').then(report);
    }, SAVE_AFTER_MS);
  };

  // Sharing saves the view as the person's own too, so it stays linked to
  // the brand's and their later changes keep updating both.
  const share = async (on: boolean) => {
    onViewsChange({ mine: view, brand: on ? view : null });
    const result = on
      ? await savePromptTableView(brandId, view, 'brand')
      : await removePromptTableView(brandId, 'brand');
    report(result);
    if (!result.ok) return onViewsChange(views);
    if (on && views.mine === null) report(await savePromptTableView(brandId, view, 'mine'));
  };

  const reset = async () => {
    if (timer.current) clearTimeout(timer.current);
    onViewsChange({ mine: null, brand: views.brand });
    report(await removePromptTableView(brandId, 'mine'));
  };

  const shown = visibleColumns(view).length;
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" />}
      >
        <Columns3 className="h-3.5 w-3.5" aria-hidden />
        {t('button', { count: shown })}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-3">
        <div className="space-y-1">
          <PopoverTitle className="text-sm font-semibold">{t('title')}</PopoverTitle>
          <p className="text-xs text-muted-foreground">
            {shared
              ? t('sharedMine', { brand: brandName })
              : views.mine === null && views.brand !== null
                ? t('fromBrand', { brand: brandName })
                : t('mine')}
          </p>
        </div>
        <ul className="space-y-0.5" aria-label={t('title')}>
          <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground">
            <span className="w-4" aria-hidden />
            <Checkbox checked disabled aria-label={t('promptColumn')} />
            <span className="flex-1">{t('promptColumn')}</span>
            <span className="text-xs">{t('always')}</span>
          </li>
          {view.order.map((id, i) => {
            const label = labelOf(id);
            const location = isLocationColumn(id);
            const visible = !view.hidden.includes(id);
            return (
              <li
                key={id}
                draggable
                onDragStart={(e) => {
                  setDragging(id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (dragging && dragging !== id) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging && dragging !== id) change(moveColumn(view, dragging, id));
                  setDragging(null);
                }}
                onDragEnd={() => setDragging(null)}
                className={cn(
                  'group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/60',
                  dragging === id && 'opacity-50',
                )}
              >
                <GripVertical
                  className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground/60"
                  aria-hidden
                />
                <Checkbox
                  id={`prompt-column-${id}`}
                  checked={visible}
                  onCheckedChange={(v) => change(toggleColumn(view, id, v === true))}
                />
                <label
                  htmlFor={`prompt-column-${id}`}
                  className={cn('flex-1 cursor-pointer', !visible && 'text-muted-foreground')}
                >
                  {label}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={i === 0}
                  aria-label={t('moveUp', { column: label })}
                  onClick={() => change(moveColumn(view, id, -1))}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={i === view.order.length - 1}
                  aria-label={t('moveDown', { column: label })}
                  onClick={() => change(moveColumn(view, id, 1))}
                >
                  <ChevronDown />
                </Button>
                {location && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('remove', { column: label })}
                    onClick={() => change(removeColumn(view, id))}
                  >
                    <X />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {locations.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t('addLocation')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t('metric')}
                value={newMetric}
                onChange={(e) => setNewMetric(e.target.value as LocationMetric)}
                className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
              >
                {LOCATION_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {tMetrics(m)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('location')}
                value={region}
                onChange={(e) => setNewRegion(e.target.value)}
                className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
              >
                {locations.map((r) => (
                  <option key={r} value={r}>
                    {regionLabel(r)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={!region || locationCount >= MAX_LOCATION_COLUMNS}
                onClick={() => change(addLocationColumn(view, newMetric, region))}
              >
                {t('add')}
              </Button>
            </div>
            {locationCount >= MAX_LOCATION_COLUMNS && (
              <p className="text-xs text-muted-foreground">
                {t('locationLimit', { count: MAX_LOCATION_COLUMNS })}
              </p>
            )}
          </div>
        )}
        {canManage ? (
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
            <Checkbox
              id="prompt-columns-share"
              className="mt-0.5"
              checked={shared}
              onCheckedChange={(v) => void share(v === true)}
            />
            <label htmlFor="prompt-columns-share" className="space-y-0.5 text-sm">
              <span className="block font-medium">{t('share', { brand: brandName })}</span>
              <span className="block text-xs text-muted-foreground">{t('shareHint')}</span>
            </label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('managersShare')}</p>
        )}
        <div className="flex items-center justify-between border-t pt-3">
          <button
            type="button"
            onClick={() => void reset()}
            disabled={views.mine === null}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
          >
            {views.brand ? t('resetToBrand') : t('reset')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
