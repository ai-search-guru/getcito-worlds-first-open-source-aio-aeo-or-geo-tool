'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/useUserRole';
import { StartPlanNow, StartPlanNowButton } from './StartPlanNow';
import { useGetMore } from './getMoreContext';

/**
 * Whether an own key is a way to get more (CHAT-16 item 19): always before
 * Chat draws on the allowance (today's Agent Chat runs on one), then only
 * on Enterprise.
 */
export function ownKeyOffered(usage: { plan: string; chatMetered?: boolean }): boolean {
  return usage.plan === 'enterprise' || !usage.chatMetered;
}

/**
 * Where to get more AI usage, in the meter's popover and the used-up banner
 * (AI usage spec §3.1, §4; CHAT-18 §B item 6). With Chat on, Get more AI
 * credits opens the Get more window, for every member: the others see the
 * packs there and ask an Admin. Otherwise a bigger plan, an admin's to
 * change, and nothing for other members (they are told to ask one);
 * Enterprise has no bigger plan to move to. In the free trial, more comes
 * with starting the plan: Start my plan now ends the trial here (the trial
 * can't buy packs). The own-key link only where an own key helps
 * (ownKeyOffered), for Admins. `primary` makes the first one the area's one
 * black button.
 */
export function AiUsageGetMore({
  plan,
  trial = false,
  chatMetered = false,
  primary,
  onFollow,
  onStartPlan,
}: {
  plan: string;
  trial?: boolean;
  /** Chat draws on the AI budget (CHAT_AGENTIC on). */
  chatMetered?: boolean;
  primary: boolean;
  /** When a link is followed: the popover closes. */
  onFollow?: () => void;
  /**
   * Start my plan now in a popover, which holds the dialog outside itself:
   * without it, the button brings its own dialog.
   */
  onStartPlan?: () => void;
}) {
  const t = useTranslations('aiUsage.getMore');
  const { canAdmin } = useUserRole();
  const openGetMore = useGetMore();
  const getMore = openGetMore && !trial ? openGetMore : null;
  if (!canAdmin && !getMore) return null;
  return (
    <>
      {getMore ? (
        <Button
          size="sm"
          variant={primary ? 'default' : 'outline'}
          data-action="credits.getMore"
          onClick={() => {
            onFollow?.();
            getMore('ai');
          }}
        >
          {t('credits')}
        </Button>
      ) : trial ? (
        onStartPlan ? (
          <StartPlanNowButton variant={primary ? 'default' : 'outline'} onClick={onStartPlan} />
        ) : (
          <StartPlanNow variant={primary ? 'default' : 'outline'} />
        )
      ) : (
        plan !== 'enterprise' && (
          <Link
            href="/dashboard/settings/billing"
            onClick={onFollow}
            className={buttonVariants({ variant: primary ? 'default' : 'outline', size: 'sm' })}
          >
            {t('plan')}
          </Link>
        )
      )}
      {canAdmin && ownKeyOffered({ plan, chatMetered }) && (
        <Link
          href="/dashboard/settings/ai-providers"
          onClick={onFollow}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('ownKey')}
        </Link>
      )}
    </>
  );
}
