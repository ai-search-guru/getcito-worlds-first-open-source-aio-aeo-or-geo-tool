'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { removedTargets } from '@/lib/action-center/entityCounts';

/**
 * "(1 prompt removed since this action was created)" beside an action's
 * count (AC-009): prompts deleted or paused, or competitors deleted, since
 * the action kept its list. Hover or focus names them. Nothing when none
 * were. A click on it stays on it: in a table row, it doesn't open the drawer.
 */
export function RemovedNote({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage');
  const removed = removedTargets(payload);
  if (!removed) return null;
  const entity = typeof payload.targetEntity === 'string' ? payload.targetEntity : null;
  const note = t('removed.note', {
    items: entity ? t(`tags.${entity}`, { count: removed.count }) : String(removed.count),
  });
  if (removed.labels.length === 0) {
    return <span className="self-center text-[10px] text-muted-foreground">{note}</span>;
  }
  const names = removed.labels.join(', ');
  const more = removed.count - removed.labels.length;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            className="cursor-help self-center rounded-sm text-[10px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        {note}
      </TooltipTrigger>
      <TooltipContent className="max-w-80 text-left">
        {more > 0 ? t('removed.hoverMore', { names, more }) : t('removed.hover', { names })}
      </TooltipContent>
    </Tooltip>
  );
}
