'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'on' | 'sync' | 'off';

const DOT: Record<Tone, string> = {
  on: 'bg-emerald-500',
  sync: 'bg-amber-500',
  off: 'bg-muted-foreground/30',
};

/** One source: a status dot by the title, a sub-line, and its button. */
export function SourceCard({
  tone,
  title,
  line,
  action,
}: {
  tone: Tone;
  title: string;
  line: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 bg-card px-4 py-3">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" title={title}>
          {title}
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{line}</p>
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
