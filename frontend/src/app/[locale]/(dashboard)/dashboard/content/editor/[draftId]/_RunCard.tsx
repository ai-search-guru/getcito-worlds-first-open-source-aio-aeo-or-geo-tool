'use client';

import { useTranslations } from 'next-intl';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The card each Instructions segment starts with (Content Editor v1.1,
 * CE-028/CE-031): what stands, on the left (a status line and its detail),
 * what the agent can do about it on the right, and an ⓘ whose tip opens
 * below it. Why the agent can't run now is written under the card, in
 * amber, never only in a hover.
 */
export function RunCard({
  title,
  detail,
  action,
  info,
  data,
  blocked,
  children,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  /** The button (or split button) that runs the agent; none when there's nothing to run. */
  action?: React.ReactNode;
  /** What the button does, in the ⓘ's tip. */
  info: React.ReactNode;
  /** The data the agent writes from, right under the card (CE-032). */
  data?: React.ReactNode;
  /** Why the agent can't run now, or null. */
  blocked?: string | null;
  /** Last, under the reason: the advice line, the usage, a question the button asked. */
  children?: React.ReactNode;
}) {
  const t = useTranslations('contentEditor.editor.run');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
        <div className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          {detail && <p className="truncate">{detail}</p>}
        </div>
        {action}
        <Tooltip>
          <TooltipTrigger
            delay={150}
            closeDelay={0}
            render={
              <button
                type="button"
                aria-label={t('about')}
                className="flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border text-[11px] font-semibold text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              />
            }
          >
            i
          </TooltipTrigger>
          {/* Below the icon, so the panel's edge never cuts it off. */}
          <TooltipContent side="bottom" className="max-w-60 leading-relaxed">
            {info}
          </TooltipContent>
        </Tooltip>
      </div>
      {data}
      {/* Always there, so a screen reader hears the reason when it comes. */}
      <p
        role="status"
        className={cn('text-xs text-amber-700 dark:text-amber-400', !blocked && 'sr-only')}
      >
        {blocked}
      </p>
      {children}
    </div>
  );
}
