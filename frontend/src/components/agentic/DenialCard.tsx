'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { CHOOSE_PLAN_HREF, useUpgradeGate } from '@/components/context/upgradeGate';
import type { ChatHref } from '@/lib/chat/events';
import { cn } from '@/lib/utils';
import { AgentCard, AgentHead } from './AgentCard';
import { TICK_CIRCLE, TickIcon } from './DoneTick';

/** What a denial offers next (CHAT-20 §4c part 4); the server's list, in its order. */
export type DenialNextAction =
  'ask_admin' | 'see_access' | 'upgrade' | 'choose_plan' | 'compare_plans' | 'open_policy';

export const DENIAL_NEXT_ACTIONS: readonly DenialNextAction[] = [
  'ask_admin',
  'see_access',
  'upgrade',
  'choose_plan',
  'compare_plans',
  'open_policy',
];

type DenialLink = Exclude<DenialNextAction, 'ask_admin'>;

/** Each next step's CHAT-23 id. */
const ACTION_ID: Record<DenialNextAction, string> = {
  ask_admin: 'access.askAdmin',
  see_access: 'access.see',
  upgrade: 'plan.upgrade',
  choose_plan: 'plan.upgrade',
  compare_plans: 'plan.compare',
  open_policy: 'policy.open',
};

/**
 * Where the links go today: Roles & access is in Settings › Team (CHAT-20
 * §4a); plans are in Settings › Billing. Settings › Chat's tool policy comes
 * with its own page (B3): until then See tool policy needs its href given.
 */
const DEFAULT_HREFS: Partial<Record<DenialLink, ChatHref>> = {
  see_access: '/dashboard/settings/team',
  upgrade: CHOOSE_PLAN_HREF,
  choose_plan: CHOOSE_PLAN_HREF,
  compare_plans: CHOOSE_PLAN_HREF,
};

type AskState = 'idle' | 'sending' | 'sent' | 'error';

/**
 * The out-of-permission answer (CHAT-mockup-v2 `#s-denied`, CHAT-20 §4c): no
 * silent failure, never a bare error, in four parts — what was asked, why not
 * (the exact rule and where it is set), who can (by role, never a person), and
 * what to do next as buttons. The parts come from the server's denial (A3's
 * buildDenial), never from the model. For a plan gate, what the next plan
 * adds (`extra`). Ask your Admin sends the request through `onAskAdmin`
 * (B2's access.request), through the read-only gate, then says Sent.
 */
export function DenialCard({
  title,
  subtitle,
  asked,
  askedItems,
  why,
  whySource,
  whoCan,
  nextActions,
  extra,
  hrefs,
  footnote,
  onAskAdmin,
}: {
  /** The agent's line: "I can't add these prompts for you". */
  title: string;
  subtitle?: string;
  /** 1. What was asked, in the person's words. */
  asked: string;
  /** What the ask lists ("best aeo tools", "aeo vs seo"…), as small tiles. */
  askedItems?: string[];
  /** 2. Why not: the rule. */
  why: string;
  /** Where the rule is set: "Settings › Team › Roles & access"; null for nowhere. */
  whySource?: string | null;
  /** 3. Who can: "Admins and Managers can do this." */
  whoCan: string;
  /** 4. What next. */
  nextActions: DenialNextAction[];
  /** A plan gate's "Growth adds" list and its price line. */
  extra?: { label: string; items: { title: string; detail?: string }[]; note?: string };
  /** Overrides or adds where a link goes. */
  hrefs?: Partial<Record<DenialLink, ChatHref>>;
  /** The quiet line under it: "Nothing was changed · nothing outside your access was shown". */
  footnote?: string;
  /** Sends the request to the workspace's Admins; a rejection shows Retry. */
  onAskAdmin?: () => void | Promise<unknown>;
}) {
  const t = useTranslations('agentic.denialCard');
  const { guard } = useUpgradeGate();
  const [ask, setAsk] = useState<AskState>('idle');
  const links = { ...DEFAULT_HREFS, ...hrefs };
  const shown = nextActions.filter((a) => a === 'ask_admin' || links[a]);

  const askAdmin = guard(
    async () => {
      setAsk('sending');
      try {
        await onAskAdmin?.();
        setAsk('sent');
        toast.success(t('sentToast'));
      } catch {
        setAsk('error');
      }
    },
    { action: t('askNeedsPlan') },
  );

  return (
    <div data-slot="denial-card">
      <AgentHead state="idle" title={title} subtitle={subtitle} />
      <AgentCard aria-label={title}>
        <dl className="m-0 grid grid-cols-1 gap-x-3.5 gap-y-2.5 px-3.5 py-3 text-[13.5px] sm:grid-cols-[88px_minmax(0,1fr)]">
          <dt className={DT}>{t('asked')}</dt>
          <dd data-part="asked" className={DD}>
            {asked}
            {askedItems && askedItems.length > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                {askedItems.map((item) => (
                  <span
                    key={item}
                    className="max-w-full truncate rounded-lg border bg-muted px-[9px] py-[3px] text-[12.5px]"
                  >
                    {item}
                  </span>
                ))}
              </span>
            )}
          </dd>
          <dt className={DT}>{t('why')}</dt>
          <dd data-part="why" className={DD}>
            {why}
            {whySource && <span className={EM}>{whySource}</span>}
          </dd>
          <dt className={DT}>{t('who')}</dt>
          <dd data-part="who" className={DD}>
            {whoCan}
            {nextActions.includes('ask_admin') && <span className={EM}>{t('requestGoes')}</span>}
          </dd>
          {extra && (
            <>
              <dt className={DT}>{extra.label}</dt>
              <dd className={DD}>
                <ul className="m-0 mt-1.5 mb-0.5 grid list-none gap-1.5 p-0 text-[13px]">
                  {extra.items.map((item) => (
                    <li
                      key={item.title}
                      className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-5 items-center justify-center rounded-full',
                          TICK_CIRCLE,
                        )}
                      >
                        <TickIcon className="size-[13px]" />
                      </span>
                      <span>
                        <b className="font-semibold">{item.title}</b>
                        {item.detail && (
                          <span className="text-muted-foreground"> · {item.detail}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {extra.note && <span className={EM}>{extra.note}</span>}
              </dd>
            </>
          )}
          {shown.length > 0 && (
            <>
              <dt className={DT}>{t('next')}</dt>
              <dd data-part="next" className={cn(DD, 'flex flex-wrap gap-1.5')}>
                {shown.map((action, i) =>
                  action === 'ask_admin' ? (
                    <Button
                      key={action}
                      data-action={ACTION_ID[action]}
                      size="sm"
                      variant={i === 0 ? 'default' : 'outline'}
                      disabled={ask === 'sending' || ask === 'sent' || !onAskAdmin}
                      aria-busy={ask === 'sending' || undefined}
                      onClick={askAdmin}
                    >
                      {ask === 'sending' && (
                        <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
                      )}
                      {ask === 'sent' ? t('sent') : t('actions.ask_admin')}
                    </Button>
                  ) : (
                    <Link
                      key={action}
                      href={links[action]!}
                      data-action={ACTION_ID[action]}
                      className={buttonVariants({
                        variant: i === 0 ? 'default' : 'outline',
                        size: 'sm',
                      })}
                    >
                      {t(`actions.${action}`)}
                    </Link>
                  ),
                )}
                {ask === 'error' && (
                  <span role="alert" className="w-full text-xs text-red-700 dark:text-red-300">
                    {t('sendFailed')}
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      </AgentCard>
      {footnote && <p className="-mt-2 mb-4 text-[11.5px] text-muted-foreground">{footnote}</p>}
    </div>
  );
}

const DT = 'pt-[3px] text-[11px] tracking-[.4px] text-muted-foreground uppercase';
const DD = 'm-0 min-w-0';
const EM = 'block text-xs text-muted-foreground';
