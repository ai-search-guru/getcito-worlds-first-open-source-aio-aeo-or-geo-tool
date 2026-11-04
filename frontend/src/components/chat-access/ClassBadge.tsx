'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AccessClass } from '@/lib/chat/access';

/** READ / WRITE / EXECUTE / NEVER, as CHAT-20's pages mark a row (mockup .cls). */
const STYLE: Record<AccessClass, string> = {
  read: 'bg-muted text-muted-foreground',
  write: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  execute: 'bg-foreground text-background',
  never: 'border border-dashed text-muted-foreground',
};

export function ClassBadge({ cls, className }: { cls: AccessClass; className?: string }) {
  const t = useTranslations('chatAccess.classes');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md px-1.5 py-px font-mono text-[10.5px] font-medium tracking-wide whitespace-nowrap',
        STYLE[cls],
        className,
      )}
    >
      {t(cls)}
    </span>
  );
}
