'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Tag } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUserRole } from '@/hooks/useUserRole';
import { ADD_TOPIC_HREF } from '@/lib/topicsRequired';
import { cn } from '@/lib/utils';

/**
 * Prompts are grouped under topics, so a brand with none can't add prompts
 * or have them suggested. Where someone tries, they are told so and sent to
 * add a topic; back here, the same button works, as every flow reads the
 * brand's topics again. The buttons stay visible: the person learns what is
 * missing by using them. Adding a topic is an admin's or a manager's (#1790):
 * anyone else is told whom to ask, with no way in that would be refused.
 */

/** Where "Add a topic" goes, for a flow that isn't on the Prompts page itself. */
export interface AddTopicTarget {
  /**
   * Opens Add Topic in place, for the Prompts page's own tabs: the page reads
   * its tab from the route only when it opens, so a link there would change
   * the address alone. Given, "Add a topic" is a button that calls it.
   */
  onAddTopic?: () => void;
  /** The page to link to without `onAddTopic`: the Topics tab with Add Topic open, by default. */
  href?: string;
}

/** "Add a topic", for admins and managers; nothing for anyone else. */
export function AddTopicLink({
  onAddTopic,
  href = ADD_TOPIC_HREF,
  onClick,
}: AddTopicTarget & {
  /** Also called on a click, before it goes: a dialog closes itself. */
  onClick?: () => void;
}) {
  const t = useTranslations('topicFirst');
  const { canManage } = useUserRole();
  if (!canManage) return null;
  if (onAddTopic) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onClick?.();
          onAddTopic();
        }}
      >
        <Plus />
        {t('addTopic')}
      </Button>
    );
  }
  return (
    <Link href={href} className={buttonVariants({ size: 'sm' })} onClick={onClick}>
      <Plus />
      {t('addTopic')}
    </Link>
  );
}

/** What to do: add a topic, or ask an admin or a manager to. */
function useTopicFirstBody(): string {
  const t = useTranslations('topicFirst');
  const tManagers = useTranslations('managersOnly');
  const { canManage } = useUserRole();
  return canManage ? t('body') : tManagers('addTopic');
}

/** The same words inside the card or dialog the person was in, as its plan-limit note is. */
export function TopicFirstNotice({ className }: { className?: string }) {
  const t = useTranslations('topicFirst');
  const body = useTopicFirstBody();
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30',
        className,
      )}
    >
      <Tag className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <div className="space-y-1">
        <p className="font-medium text-amber-900 dark:text-amber-200">{t('title')}</p>
        <p className="text-amber-800/80 dark:text-amber-300/80">{body}</p>
      </div>
    </div>
  );
}

/** For a button that had nothing of its own to show it in: a click answered `no_topics`. */
export function TopicFirstDialog({
  open,
  onOpenChange,
  ...target
}: AddTopicTarget & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('topicFirst');
  const common = useTranslations('common');
  const { canManage } = useUserRole();
  const body = useTopicFirstBody();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            {canManage ? common('cancel') : t('close')}
          </DialogClose>
          <AddTopicLink {...target} onClick={() => onOpenChange(false)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog and its opener for one component: render `dialog` once and call
 * `show()` when a write or a generation comes back `no_topics`.
 */
export function useTopicFirstDialog(target: AddTopicTarget = {}) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return { show, dialog: <TopicFirstDialog open={open} onOpenChange={setOpen} {...target} /> };
}
