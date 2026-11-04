'use client';

import { useState, type ReactElement } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  createTooltipHandle,
} from '@/components/ui/tooltip';

/** One tooltip shared by every cut text in a table (see ClampedText). */
export type ClampedTextHandle = ReturnType<typeof createTooltipHandle<string | null>>;

export function createClampedTextHandle(): ClampedTextHandle {
  return createTooltipHandle<string | null>();
}

/** Whether CSS cut the element's text short (line-clamp, truncate). */
export function isTextCut(el: {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  // A pixel of slack: subpixel layout can leave scroll a hair over client.
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

/**
 * Text that CSS cuts short and shows in full on hover, only when it was cut:
 * a short text has nothing more to show. Every row shares one tooltip through
 * `handle`, so a long table doesn't mount one per cell; render
 * ClampedTextTooltip once beside them. The whole text stays in the element,
 * so screen readers read it in full either way.
 */
export function ClampedText({
  handle,
  text,
  render,
}: {
  handle: ClampedTextHandle;
  text: string;
  /** The element that cuts the text, e.g. a link with `line-clamp-2`. */
  render: ReactElement;
}) {
  const [cut, setCut] = useState(false);
  return (
    <TooltipTrigger
      handle={handle}
      payload={cut ? text : null}
      delay={300}
      closeDelay={0}
      render={render}
      // Measured as the tooltip is about to open, by pointer or keyboard focus.
      onPointerEnter={(e) => setCut(isTextCut(e.currentTarget))}
      onFocus={(e) => setCut(isTextCut(e.currentTarget))}
    >
      {text}
    </TooltipTrigger>
  );
}

/**
 * The shared tooltip. It opens over the neighbouring row, so it lets the
 * pointer through and closes as soon as the pointer leaves the text: moving
 * to the next row must reach that row, not stay on this tooltip.
 */
export function ClampedTextTooltip({ handle }: { handle: ClampedTextHandle }) {
  return (
    <Tooltip handle={handle} disableHoverablePopup>
      {({ payload }) =>
        payload ? (
          <TooltipContent className="pointer-events-none max-w-sm">{payload}</TooltipContent>
        ) : null
      }
    </Tooltip>
  );
}
