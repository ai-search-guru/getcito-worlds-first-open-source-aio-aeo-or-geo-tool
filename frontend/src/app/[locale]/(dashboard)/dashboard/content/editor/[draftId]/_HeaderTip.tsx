'use client';

import { cloneElement, useId, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * An icon button's label in the editor header (Next step spec §3b): the
 * app's tooltip, under the button, on hover and on keyboard focus, and
 * closed with Escape. The button keeps its aria-label, and the hint is its
 * description for screen readers too. The tip sits on a span around the
 * button, so a disabled one (no pointer events) still shows why it waits.
 */
export function HeaderTip({
  label,
  hint,
  narrowOnly = false,
  children,
}: {
  label: string;
  hint?: string;
  /** For a button that shows its label where there's room: the tip only narrower than 1024px. */
  narrowOnly?: boolean;
  /** The button; it gets the hint as its description. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}) {
  const hintId = useId();
  return (
    <Tooltip>
      <TooltipTrigger delay={300} closeDelay={0} render={<span className="inline-flex" />}>
        {hint ? cloneElement(children, { 'aria-describedby': hintId }) : children}
        {hint && (
          <span id={hintId} hidden>
            {hint}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className={cn('max-w-60', narrowOnly && 'lg:hidden')}>
        <span className="block font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-muted-foreground [overflow-wrap:anywhere]">
            {hint}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
