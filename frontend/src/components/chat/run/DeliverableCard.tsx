'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Check,
  Code,
  Copy,
  Download,
  Ellipsis,
  FileBarChart,
  FileText,
  Image as ImageIcon,
  PenLine,
  Table,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGetMore } from '@/components/ai-usage/getMoreContext';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import {
  attachOnlyFromCard,
  markTaskDoneFromCard,
  undoTaskDoneFromCard,
  type TaskCardResult,
} from '@/lib/actions/chatTaskCard';
import type { ChatDeliverable, ChatTaskStrip } from '@/lib/chat/events';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';

/** Each type's icon, on its card and its Files row. */
export const DELIVERABLE_ICONS = {
  document: FileText,
  table: Table,
  code: Code,
  image: ImageIcon,
  report: FileBarChart,
} as const;

/** The formats a card offers, in Download's order (CHAT-06 item 4). */
const FORMAT_ORDER = ['html', 'md', 'docx', 'pdf', 'csv', 'xlsx'] as const;

const ACTION =
  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Whether a deliverable is in Files (an older event says nothing: it was). */
export const isFiled = (deliverable: ChatDeliverable) =>
  deliverable.filed === undefined || deliverable.filed === 'in_files';

/**
 * Each deliverable's place among the run's filed ones, which names its file
 * on the server (readRunFile); null for one that wasn't filed, which has no
 * file to read.
 */
export function filedNumbers(deliverables: ChatDeliverable[]): (number | null)[] {
  let n = 0;
  return deliverables.map((deliverable) => (isFiled(deliverable) ? ++n : null));
}

/** The file name a download came with (Content-Disposition), else one of our own. */
function fileNameOf(res: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  return named?.[1] ?? fallback;
}

/**
 * An output card (CHAT-06 items 1–6, mockup `#s-done`): what a run made,
 * with its type's icon, its title and a line saying whether it is in
 * Files, or why not (item 29). Copy and Download read its file, in the
 * formats its type offers; a page Chat saved opens in the Content Editor.
 * `n` is its place among the run's deliverables, which names its file.
 *
 * A deliverable drafted for an Action Center task (CHAT-09 items 12–16)
 * says "Task: {title}" and, for an Admin or a Manager (`canChange`), offers
 * Attach to task & mark done, with Undo in its toast, and Attach only in
 * its ⋯ menu: the person's own clicks, never Chat's. `onTasks` gets the
 * run's task strip as it stands after one.
 */
export function DeliverableCard({
  runId,
  n,
  deliverable,
  canChange = false,
  onTasks,
}: {
  runId: string;
  n: number;
  deliverable: ChatDeliverable;
  canChange?: boolean;
  onTasks?: (strip: ChatTaskStrip) => void;
}) {
  const t = useTranslations('chatDeliverable');
  const tFormats = useTranslations('chatAnswer.formats');
  const tReadOnly = useTranslations('readOnly.actions');
  const openGetMore = useGetMore();
  const { guard, openUpgrade } = useUpgradeGate();
  const [fileStatus, setFileStatus] = useState(deliverable.status);
  const [task, setTask] = useState(deliverable.task ?? null);
  const [busy, setBusy] = useState(false);
  const Icon = DELIVERABLE_ICONS[deliverable.type] ?? FileText;
  const filed = isFiled(deliverable);
  const formats = FORMAT_ORDER.filter((format) => deliverable.formats.includes(format));
  const fileUrl = (format: string) => `/api/chat/runs/${runId}/files/${n}?format=${format}`;

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      // Safari copies only within the click: the item is written at once, its text to come.
      const text = fetch(fileUrl('md')).then(async (res) => {
        if (!res.ok) throw new Error('Not read');
        return new Blob([await res.text()], { type: 'text/plain' });
      });
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
      } else {
        await navigator.clipboard.writeText(await (await text).text());
      }
      toast(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function download(format: string) {
    const res = await fetch(fileUrl(format)).catch(() => null);
    if (!res?.ok) {
      toast.error(t('downloadFailed'));
      return;
    }
    const name = fileNameOf(res, `file.${format}`);
    saveBlob(await res.blob(), name);
    toast(t('downloaded', { name }));
  }

  /** A click's answer: the card and the strip as they stand, or why not. */
  function settle(result: TaskCardResult, label: string): boolean {
    if (result.ok) {
      setFileStatus(result.status);
      setTask(result.task);
      if (result.strip) onTasks?.(result.strip);
      return true;
    }
    if (result.failure === 'read_only') openUpgrade(label);
    else toast.error(t(`task.failed.${result.failure}`));
    return false;
  }

  async function change(
    write: (runId: string, n: number) => Promise<TaskCardResult>,
    label: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      return settle(await write(runId, n), label);
    } catch {
      toast.error(t('task.failed.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const doneLabel = tReadOnly('markTaskDone');
  async function markDone() {
    if (!(await change(markTaskDoneFromCard, doneLabel))) return;
    toast.success(t('task.markedDone'), {
      action: { label: t('task.undo'), onClick: () => void undo() },
    });
  }
  async function undo() {
    if (await change(undoTaskDoneFromCard, doneLabel)) toast(t('task.undone'));
  }
  async function attachOnly() {
    if (await change(attachOnlyFromCard, tReadOnly('attachFiles'))) toast(t('task.attached'));
  }

  const status =
    deliverable.filed === 'storage_full'
      ? t('storageFull')
      : deliverable.filed === 'failed'
        ? t('notFiled')
        : deliverable.href
          ? t('usedInDraft')
          : t('inFiles');

  return (
    <article
      data-slot="deliverable-card"
      aria-label={deliverable.title}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{deliverable.title}</p>
          <p
            className={cn(
              'text-xs text-muted-foreground',
              !filed && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {t(`types.${deliverable.type}`)} · {status}
          </p>
          {task && (
            <p data-slot="deliverable-task" className="truncate text-xs text-muted-foreground">
              {t('task.line', { title: task.title || t('task.untitled') })}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {filed && (
          <>
            <button
              type="button"
              data-action="deliverable.copy"
              onClick={() => void copy()}
              className={ACTION}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('copy')}
            </button>
            {formats.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger data-action="deliverable.download" className={ACTION}>
                  <Download className="size-3.5" aria-hidden />
                  {t('download')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {formats.map((format) => (
                    <DropdownMenuItem
                      key={format}
                      data-action="deliverable.downloadAs"
                      data-format={format}
                      onClick={() => void download(format)}
                      className="text-[13px]"
                    >
                      {tFormats(format)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
        {deliverable.filed === 'storage_full' && openGetMore && (
          <button
            type="button"
            data-action="deliverable.getMoreStorage"
            onClick={() => openGetMore('storage')}
            className={cn(ACTION, 'text-foreground')}
          >
            {t('getMoreStorage')}
          </button>
        )}
        {deliverable.href && (
          <Link
            href={deliverable.href}
            data-action="deliverable.openEditor"
            className={cn(ACTION, 'text-foreground')}
          >
            <PenLine className="size-3.5" aria-hidden />
            {t('openEditor')}
          </Link>
        )}
        {filed && task && (
          <TaskControls
            fileStatus={fileStatus}
            taskState={task.state}
            canChange={canChange}
            busy={busy}
            onMarkDone={guard(() => void markDone(), { action: doneLabel })}
            onAttachOnly={guard(() => void attachOnly(), { action: tReadOnly('attachFiles') })}
          />
        )}
      </div>
    </article>
  );
}

/**
 * The card's task controls (CHAT-09 items 13, 16): "Done · attached to task"
 * once it is; "Done in Action Center" for a task closed there; else, for
 * an Admin or a Manager, Attach to task & mark done, and Attach only in ⋯
 * while the file isn't attached yet.
 */
function TaskControls({
  fileStatus,
  taskState,
  canChange,
  busy,
  onMarkDone,
  onAttachOnly,
}: {
  fileStatus: ChatDeliverable['status'];
  taskState: 'open' | 'done';
  canChange: boolean;
  busy: boolean;
  onMarkDone: () => void;
  onAttachOnly: () => void;
}) {
  const t = useTranslations('chatDeliverable.task');
  if (taskState === 'done') {
    return (
      <span
        data-slot="task-done"
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
      >
        <Check className="size-3" aria-hidden />
        {fileStatus === 'done' ? t('doneAttached') : t('doneInActionCenter')}
      </span>
    );
  }
  if (!canChange) return null;
  return (
    <div className="ml-auto flex items-center gap-1">
      <button
        type="button"
        data-action="deliverable.attachAndMarkDone"
        disabled={busy}
        onClick={onMarkDone}
        className={buttonVariants({ size: 'sm' })}
      >
        {t('markDone')}
      </button>
      {fileStatus === 'draft' && (
        <DropdownMenu>
          <DropdownMenuTrigger
            data-action="deliverable.more"
            aria-label={t('more')}
            disabled={busy}
            className={ACTION}
          >
            <Ellipsis className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              data-action="deliverable.attachOnly"
              onClick={onAttachOnly}
              className="text-[13px]"
            >
              {t('attachOnly')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
