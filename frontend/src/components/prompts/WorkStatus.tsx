'use client';

/**
 * Prompt workflow status badge + picker. One visual definition shared by the
 * All Prompts table and the prompt detail page so a status always renders
 * identically.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PromptWorkStatus } from '@/lib/actions/promptWorkflow';

export const WORK_STATUS_META: Record<PromptWorkStatus, { label: string; className: string }> = {
  todo: {
    label: 'To do',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  in_progress: {
    label: 'In progress',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  done: {
    label: 'Done',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
};

export const WORK_STATUS_ORDER: PromptWorkStatus[] = ['todo', 'in_progress', 'done'];

function badgeClasses(status: PromptWorkStatus | null) {
  return status
    ? WORK_STATUS_META[status].className
    : 'border-dashed border-muted-foreground/30 text-muted-foreground';
}

/**
 * Read-only badge, or a dropdown picker when `onChange` is provided
 * (admin/manager). `null` renders a dashed "Set status" affordance in edit
 * mode and an em dash in read mode.
 */
export function WorkStatusBadge({
  status,
  onChange,
}: {
  status: PromptWorkStatus | null;
  onChange?: (status: PromptWorkStatus | null) => void;
}) {
  if (!onChange) {
    if (!status) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <Badge variant="outline" className={cn('text-xs whitespace-nowrap', badgeClasses(status))}>
        {WORK_STATUS_META[status].label}
      </Badge>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors',
          badgeClasses(status),
        )}
        aria-label="Set work status"
      >
        {status ? WORK_STATUS_META[status].label : 'Set status'}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {WORK_STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} className="gap-2 text-xs" onClick={() => onChange(s)}>
            <Check className={cn('h-3.5 w-3.5', status === s ? 'opacity-100' : 'opacity-0')} />
            {WORK_STATUS_META[s].label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className="gap-2 text-xs" onClick={() => onChange(null)}>
          <Check className={cn('h-3.5 w-3.5', status === null ? 'opacity-100' : 'opacity-0')} />
          No status
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
