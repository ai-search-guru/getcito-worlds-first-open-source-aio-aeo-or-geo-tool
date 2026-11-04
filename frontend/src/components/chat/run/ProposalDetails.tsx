'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatConfirm } from '@/lib/chat/events';

/** A task's new text shows this many characters before Show all. */
const SHORT_BODY = 160;

/** One task the action is made with: its words, where and when done, and its new text. */
function ProposalTask({ item }: { item: NonNullable<ChatConfirm['items']>[number] }) {
  const t = useTranslations('chatRun.proposal');
  const [open, setOpen] = useState(false);
  const long = !!item.body && item.body.length > SHORT_BODY;
  const body = item.body && long && !open ? `${item.body.slice(0, SHORT_BODY - 1)}…` : item.body;
  return (
    <li className="rounded-xl border px-2.5 py-2 text-[13px]">
      <p className="m-0 font-medium">{item.title}</p>
      {item.detail && <p className="m-0 text-xs text-muted-foreground">{item.detail}</p>}
      {body && (
        <div className="mt-1.5 rounded-lg bg-green-50 px-2 py-1.5 text-xs text-green-900 dark:bg-green-950/40 dark:text-green-200">
          <span className="sr-only">{t('newText')}: </span>
          <span className="whitespace-pre-line">{body}</span>
          {long && (
            <button
              type="button"
              data-action="approval.showAll"
              aria-expanded={open}
              onClick={() => setOpen((was) => !was)}
              className="ml-1 rounded font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {open ? t('showLess') : t('showAll')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * What Send to Action Center freezes once it's made (CHAT-09 items 18,
 * 18b), on its approval card: the tasks with their new text (shortened,
 * Show all), the goal, and what it is sent with (its prompts, pages,
 * competitors and platforms). The finding is the card's "why".
 */
export function ProposalDetails({ confirm }: { confirm: ChatConfirm }) {
  const t = useTranslations('chatRun.proposal');
  const items = confirm.items ?? [];
  const targets = confirm.targets ?? [];
  if (items.length === 0 && targets.length === 0 && !confirm.goal) return null;
  return (
    <div data-slot="proposal-details" className="my-2 grid gap-2">
      {items.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {items.map((item, i) => (
            <ProposalTask key={`${i}-${item.title}`} item={item} />
          ))}
        </ul>
      )}
      {(confirm.goal || targets.length > 0) && (
        <dl className="m-0 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {confirm.goal && (
            <>
              <dt className="text-muted-foreground">{t('goal')}</dt>
              <dd className="m-0 min-w-0">{confirm.goal}</dd>
            </>
          )}
          {targets.map((target) => (
            <div key={target.kind} className="contents">
              <dt className="text-muted-foreground">{t(target.kind)}</dt>
              <dd className="m-0 min-w-0">
                {target.values.map((value, i) => (
                  <span key={`${i}-${value}`} className="block truncate" title={value}>
                    {value}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
