'use client';

import { useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ListDot, type ListDotState } from './ListDot';

/** The legend's rows, in the mockup's order: paused stays out of it. */
const LEGEND: readonly ListDotState[] = ['running', 'needsYou', 'done', 'failed', 'idle'];

/**
 * "?" beside a list of runs (Agents at work): opens "What the dots mean", one
 * row per dot (CHAT-23 `chatMenu.dotLegend`). Esc, a click outside or the
 * button closes it, and focus goes back to the button.
 */
export function DotLegend({ className }: { className?: string }) {
  const t = useTranslations('agentic.dot');
  return (
    <Popover>
      <PopoverTrigger
        data-action="chatMenu.dotLegend"
        aria-label={t('legend.title')}
        title={t('legend.title')}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-[10px] leading-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
      >
        ?
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] rounded-[14px] p-1.5 shadow-[0_12px_32px_rgba(10,10,10,.12)] motion-reduce:animate-none!"
      >
        <PopoverTitle className="px-2 pt-2 pb-1 text-[11px] font-normal tracking-[.4px] text-muted-foreground uppercase">
          {t('legend.title')}
        </PopoverTitle>
        <ul className="grid gap-1.5 p-2">
          {LEGEND.map((state) => (
            <li key={state} className="flex items-start gap-2.5 text-[12.5px]">
              <ListDot state={state} decorative className="mt-0.5" />
              <span>
                <b className="block font-bold">{t(state)}</b>
                <span className="block text-[11.5px] text-muted-foreground">
                  {t(`legend.${state}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
