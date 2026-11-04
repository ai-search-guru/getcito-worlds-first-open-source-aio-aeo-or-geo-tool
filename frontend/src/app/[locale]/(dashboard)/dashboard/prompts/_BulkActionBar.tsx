'use client';

import { ChevronDown, Lightbulb, Loader2, MapPin, Pause, Play, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The prompts table's bulk action bar (PROMPT-006): shown while rows are
 * selected, with the row menu's own actions for all of them at once. Pause
 * and Resume each show only when some selected prompt can take them;
 * Locations adds locations to them or stops some (PROMPT-015). While a
 * bulk delete runs, a few prompts per call, it shows how far it has got, even
 * with nothing selected.
 */
export function BulkActionBar({
  count,
  activeCount,
  busy,
  suggesting,
  suggestBlockedReason,
  deleting,
  onPause,
  onResume,
  onSuggestContent,
  onAddLocations,
  onRemoveLocations,
  onDelete,
  onClear,
}: {
  count: number;
  /** How many of the selected prompts are being tracked now. */
  activeCount: number;
  /** A pause, resume or suggestion run is going; the actions wait for it. */
  busy: boolean;
  suggesting: boolean;
  /** Why Suggest content can't take this selection now; null when it can. */
  suggestBlockedReason: string | null;
  /** How far the delete that is running has got; null when none is. */
  deleting: { done: number; total: number } | null;
  onPause: () => void;
  onResume: () => void;
  onSuggestContent: () => void;
  /** Open the locations dialog on the selection, to add or to stop some. */
  onAddLocations: () => void;
  onRemoveLocations: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('prompts.bulkDelete');
  const tLocations = useTranslations('prompts.addLocations');
  const pausedCount = count - activeCount;
  const progress = deleting && (
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      {t('progress', deleting)}
    </span>
  );
  // Nothing selected: only the delete's progress, at the bar's usual height.
  if (count === 0) {
    return <div className="flex h-11 items-center border-b bg-muted/50 px-4">{progress}</div>;
  }
  return (
    <div
      role="toolbar"
      aria-label="Actions for the selected prompts"
      className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2"
    >
      <span className="text-xs font-medium">{count} selected</span>
      {progress}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        {activeCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onPause}
            disabled={busy}
          >
            <Pause className="h-3 w-3" />
            Pause{pausedCount > 0 ? ` ${activeCount}` : ''}
          </Button>
        )}
        {pausedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onResume}
            disabled={busy}
          >
            <Play className="h-3 w-3" />
            Resume{activeCount > 0 ? ` ${pausedCount}` : ''}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" />}
            disabled={busy}
          >
            <MapPin className="h-3 w-3" />
            {tLocations('bulkButton')}
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onAddLocations}>{tLocations('bulkAdd')}</DropdownMenuItem>
            <DropdownMenuItem onClick={onRemoveLocations}>
              {tLocations('bulkRemove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {suggestBlockedReason && !suggesting && (
          <span className="px-1 text-[11px] text-muted-foreground">{suggestBlockedReason}</span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={onSuggestContent}
          disabled={busy || suggestBlockedReason !== null}
        >
          {suggesting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Lightbulb className="h-3 w-3" />
          )}
          Suggest content
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onClear}
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
