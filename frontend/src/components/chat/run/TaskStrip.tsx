'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import type { ChatTaskRow, ChatTaskStatus, ChatTaskStrip } from '@/lib/chat/events';
import { cn } from '@/lib/utils';

/** Each status's pill, in both themes: Queued plain, Writing working, Ready for review waiting on the person, Done done. */
const STATUS_PILL: Record<ChatTaskStatus, string> = {
  queued: 'text-muted-foreground',
  writing:
    'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
  ready_for_review:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  done: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300',
};

/**
 * The strip's rows (CHAT-09 §B item 5): each task's title as the Action
 * Center words it, "Priority 86 · Fix", and Chat's status for it, which is
 * Chat's work, never the task's Action Center status (item 6).
 */
export function TaskStripRows({ tasks }: { tasks: readonly ChatTaskRow[] }) {
  const t = useTranslations('chatRun.tasks');
  const tCategory = useTranslations('actionCenter.actionCategories');
  return (
    <ol className="m-0 list-none divide-y p-0">
      {tasks.map((task) => {
        const line = [
          task.priority !== null ? t('priority', { score: task.priority }) : null,
          task.category ? tCategory(task.category) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <li
            key={task.at}
            data-task={task.at}
            data-status={task.status}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5"
          >
            <span className="min-w-0 text-[13px]">
              <span className="block truncate">{task.title || t('untitled')}</span>
              {line && <span className="block text-xs text-muted-foreground">{line}</span>}
            </span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap',
                STATUS_PILL[task.status],
              )}
            >
              {t(`status.${task.status}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The task strip under a /tasks answer (CHAT-09 §B, mockup #s-work):
 * "Action Center tasks · 4 due", how many are ready ("1 of 3 ready",
 * CHAT-01 item 7) with its bar, the tasks, and once the run ended the line
 * of #s-done: the person closes the tasks in Action Center, Chat never does.
 * Screen readers hear what changes, once: the rows whose status moved, then
 * how many are ready when that moved. A reload or the strip's first tasks
 * say nothing; the rows are read as they are.
 */
export function TaskStrip({ strip, ended }: { strip: ChatTaskStrip; ended: boolean }) {
  const t = useTranslations('chatRun.tasks');
  const titleId = useId();
  const [seen, setSeen] = useState(strip);
  const [news, setNews] = useState('');
  // Adjust-state-during-render pattern: say what changed since the strip last drew.
  if (seen !== strip) {
    setSeen(strip);
    if (seen.total > 0) {
      const was = new Map(seen.tasks.map((task) => [task.at, task.status]));
      const said = strip.tasks
        .filter((task) => was.get(task.at) !== task.status)
        .map((task) =>
          t('changed', { title: task.title || t('untitled'), status: t(`status.${task.status}`) }),
        );
      if (strip.ready !== seen.ready || strip.total !== seen.total) {
        said.push(t('ready', { ready: strip.ready, total: strip.total }));
      }
      if (said.length) setNews(said.join('. '));
    }
  }
  if (strip.total === 0) return null;
  const share = Math.round((strip.ready / strip.total) * 100);
  const ready = t('ready', { ready: strip.ready, total: strip.total });
  return (
    <section
      data-slot="task-strip"
      aria-labelledby={titleId}
      className="rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3.5 py-2.5">
        <h3 id={titleId} className="m-0 text-[13px] font-semibold">
          {t('title', { due: strip.due })}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={t('progress')}
            aria-valuemin={0}
            aria-valuemax={strip.total}
            aria-valuenow={strip.ready}
            aria-valuetext={ready}
            className="h-1.5 w-[120px] overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${share}%` }}
            />
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap tabular-nums">
            {ready}
          </span>
        </div>
      </div>
      <p aria-live="polite" data-slot="task-strip-news" className="sr-only">
        {news}
      </p>
      <TaskStripRows tasks={strip.tasks} />
      {ended && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5">
          <span className="text-xs text-muted-foreground">{t('closeNote')}</span>
          <Link
            href="/dashboard/action-center/actions"
            data-action="done.closeTasksInActionCenter"
            className={cn(buttonVariants({ size: 'sm' }), 'ml-auto')}
          >
            {t('close')}
          </Link>
        </div>
      )}
    </section>
  );
}
