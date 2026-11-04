'use client';

import { lazy, Suspense, useCallback, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, Loader2 } from 'lucide-react';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { buttonVariants } from '@/components/ui/button-variants';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUserRole } from '@/hooks/useUserRole';
import type { ActionItem } from '@/lib/actions/actionCenter';
import { OPEN_ACTION_STATUSES } from '@/lib/action-center/registry';
import { cn } from '@/lib/utils';

/**
 * Run agent on an Action Center action (CHAT-21 §F, CHAT-09 item 21b;
 * governance mockup #g-run-agent), on its row and in its drawer: a button
 * whose popover holds the picker (RunAgentPicker.tsx). Only while the new
 * Chat is on, for Admins and Managers (§K item 51; Analysts and Agency
 * partners don't see it, as Chat hides changes from the roles that can't
 * make them), on an open action. A read-only workspace gets the upgrade
 * dialog instead of the picker. The picker's code loads the first time it
 * opens, not with every Action Center page.
 */

const RunAgentPicker = lazy(() =>
  import('./RunAgentPicker').then((module) => ({ default: module.RunAgentPicker })),
);

interface RunAgentProps {
  action: Pick<ActionItem, 'id' | 'actionNo' | 'status'>;
  /** The action's title as the page names it. */
  title: string;
  /** On the row an icon button; in the drawer's header a labelled one. */
  variant: 'row' | 'drawer';
  className?: string;
}

export function RunAgentButton(props: RunAgentProps) {
  const chatOn = useChatAgentic();
  const { canManage } = useUserRole();
  if (!chatOn || !canManage || !OPEN_ACTION_STATUSES.includes(props.action.status)) return null;
  return <RunAgentMenu {...props} />;
}

/** ↑ ↓ move between the picker's choices (Tab works too); Esc closes it. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[data-run-agent-item]:not([disabled])'),
  );
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === 'ArrowDown'
      ? items[(at + 1) % items.length]
      : items[(at - 1 + items.length) % items.length];
  next.focus();
}

function RunAgentMenu({ action, title, variant, className }: RunAgentProps) {
  const t = useTranslations('actionCenter.actionsPage.runAgent');
  const tActions = useTranslations('readOnly.actions');
  const { isLocked, openUpgrade } = useUpgradeGate();
  const [open, setOpen] = useState(false);
  // Stable: the picker reads the agents once per opening.
  const close = useCallback(() => setOpen(false), []);
  const label = t('buttonLabel', { title });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && isLocked) {
          openUpgrade(tActions('runAgentOnAction'));
          return;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        data-action="actionCenter.runAgent"
        // The drawer's top row makes room for it (ActionDrawer.tsx).
        data-run-agent=""
        aria-label={label}
        title={label}
        className={cn(
          variant === 'row'
            ? cn(
                buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
                'text-muted-foreground hover:text-foreground',
              )
            : // The size of the drawer's Copy Data and Export beside it.
              cn(buttonVariants({ variant: 'default', size: 'sm' }), 'h-7 gap-1.5 text-xs'),
          className,
        )}
        // On a row that opens on a click, only the picker opens.
        onClick={(event) => event.stopPropagation()}
      >
        <Bot aria-hidden className={variant === 'drawer' ? 'h-3 w-3' : undefined} />
        {variant === 'drawer' && t('button')}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] max-w-[calc(100vw-32px)] p-2"
        // The picker sits in a portal, but React bubbles its clicks to the row.
        onClick={(event) => event.stopPropagation()}
        onKeyDown={moveFocus}
      >
        <div className="px-2 pt-1 pb-2">
          <p className="text-sm font-semibold">{t('pickerTitle', { no: action.actionNo })}</p>
          <p className="text-xs text-muted-foreground">{t('pickerHint')}</p>
        </div>
        <Suspense fallback={<PickerLoading />}>
          <RunAgentPicker action={action} onClose={close} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

/** "Loading agents…", while the picker's code loads and while it reads the agents. */
export function PickerLoading() {
  const t = useTranslations('actionCenter.actionsPage.runAgent');
  return (
    <p role="status" className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {t('loading')}
    </p>
  );
}
