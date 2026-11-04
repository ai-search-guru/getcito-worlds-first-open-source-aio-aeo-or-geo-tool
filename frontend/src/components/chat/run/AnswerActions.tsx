'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { Marked } from 'marked';
import { toast } from 'sonner';
import { Check, Copy, Download, FolderCheck, FolderPlus, ListPlus, PenLine } from 'lucide-react';
import { useGetMore } from '@/components/ai-usage/getMoreContext';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useRouter } from '@/i18n/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { answerFormats, type AnswerExportFormat } from '@/lib/chat/export';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown as HTML for the clipboard: the answer's own HTML shown as text, never run. */
const clipboardHtml = new Marked({ renderer: { html: (token) => escapeHtml(token.text) } });

/** The file name a download came with (Content-Disposition), else one of our own. */
function fileNameOf(res: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  return named?.[1] ?? fallback;
}

const ICON =
  'flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60';

/** An icon button with its name in a tooltip on hover and on keyboard focus (item 30a). */
function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The bar under a finished answer (CHAT-06 items 30–37, 30a): Copy,
 * Download ▾ and Save to Files as 28×28 icon buttons, each named in an
 * aria-label and a tooltip. Copy takes the answer as rich text (Markdown
 * where only text goes). Download offers Markdown, Word and PDF, and CSV
 * and Excel when the answer has a table; the server renders the file from
 * the stored answer, so nothing is kept and no AI is used. Save to Files
 * files it for the workspace, once: then it reads "In Files". Open in
 * Content Editor makes a Content draft of it and opens it (item 6). Every
 * role may use them all. Send to Action Center (CHAT-09 item 18), on the
 * latest answer for Admins and Managers, asks Chat to propose it as an
 * action, on its approval card.
 */
export function AnswerActions({
  runId,
  markdown,
  filed,
  onFiled,
  onSendToActionCenter,
}: {
  runId: string;
  markdown: string;
  /** Already in Files. */
  filed: boolean;
  onFiled: (fileId: string) => void;
  /** Send to Action Center; none where it isn't offered. */
  onSendToActionCenter?: () => void;
}) {
  const t = useTranslations('chatAnswer');
  const { openUpgrade } = useUpgradeGate();
  const openGetMore = useGetMore();
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const formats = useMemo(() => answerFormats(markdown), [markdown]);
  const extensions = formats.map((format) => `.${format}`).join(' ');

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        const html = clipboardHtml.parse(markdown, { async: false }) as string;
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([markdown], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(markdown);
      }
      toast(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function download(format: AnswerExportFormat) {
    const res = await fetch(`/api/chat/runs/${runId}/export?format=${format}`).catch(() => null);
    if (!res?.ok) {
      toast.error(t('downloadFailed'));
      return;
    }
    const name = fileNameOf(res, `answer.${format}`);
    saveBlob(await res.blob(), name);
    toast(t('downloaded', { name }));
  }

  async function save() {
    if (filed || saving) return;
    setSaving(true);
    const res = await fetch(`/api/chat/runs/${runId}/file`, { method: 'POST' }).catch(() => null);
    setSaving(false);
    if (res?.status === 402) {
      openUpgrade();
      return;
    }
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      code?: string;
      file?: { id: string };
    } | null;
    if (res?.ok && body?.file) {
      onFiled(body.file.id);
      toast(t('saved'));
    } else if (body?.code === 'storage_full') {
      // Storage packs are bought in the Get more window (CHAT-18 §B item 6).
      if (openGetMore) {
        toast(t('storageFull'), {
          action: { label: t('getMoreStorage'), onClick: () => openGetMore('storage') },
        });
      } else {
        toast(t('storageFull'));
      }
    } else {
      toast.error(t('saveFailed'));
    }
  }

  async function openInEditor() {
    if (opening) return;
    setOpening(true);
    const res = await fetch(`/api/chat/runs/${runId}/content-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: activeBrandId }),
    }).catch(() => null);
    setOpening(false);
    // A read-only workspace, or the demo brand: both ask for a plan.
    if (res?.status === 402) {
      openUpgrade();
      return;
    }
    const body = (await res?.json().catch(() => null)) as { href?: string; code?: string } | null;
    if (res?.ok && body?.href) router.push(body.href);
    else toast.error(t(body?.code === 'no_brand' ? 'openEditorNoBrand' : 'openEditorFailed'));
  }

  return (
    <div role="toolbar" aria-label={t('label')} className="flex items-center gap-0.5">
      <Tip label={t('copy')}>
        <button
          type="button"
          data-action="answer.copy"
          aria-label={t('copy')}
          onClick={() => void copy()}
          className={ICON}
        >
          <Copy className="size-4" aria-hidden />
        </button>
      </Tip>
      <DropdownMenu>
        <Tip label={t('downloadTip', { formats: extensions })}>
          <DropdownMenuTrigger
            data-action="answer.download"
            aria-label={t('download')}
            className={ICON}
          >
            <Download className="size-4" aria-hidden />
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="w-44">
          {formats.map((format) => (
            <DropdownMenuItem
              key={format}
              data-action="answer.downloadAs"
              data-format={format}
              onClick={() => void download(format)}
              className="text-[13px]"
            >
              {t(`formats.${format}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tip label={filed ? t('inFiles') : t('save')}>
        <button
          type="button"
          data-action="answer.saveToFiles"
          aria-label={filed ? t('inFiles') : t('save')}
          aria-disabled={filed || saving}
          onClick={() => void save()}
          className={cn(ICON, filed && 'text-foreground')}
        >
          {filed ? (
            <FolderCheck className="size-4" aria-hidden />
          ) : saving ? (
            <Check className="size-4 animate-pulse" aria-hidden />
          ) : (
            <FolderPlus className="size-4" aria-hidden />
          )}
        </button>
      </Tip>
      <Tip label={t('openEditor')}>
        <button
          type="button"
          data-action="answer.openInEditor"
          aria-label={t('openEditor')}
          aria-disabled={opening}
          onClick={() => void openInEditor()}
          className={ICON}
        >
          <PenLine className={cn('size-4', opening && 'animate-pulse')} aria-hidden />
        </button>
      </Tip>
      {onSendToActionCenter && (
        <Tip label={t('sendToActionCenter')}>
          <button
            type="button"
            data-action="answer.sendToActionCenter"
            aria-label={t('sendToActionCenter')}
            onClick={onSendToActionCenter}
            className={ICON}
          >
            <ListPlus className="size-4" aria-hidden />
          </button>
        </Tip>
      )}
    </div>
  );
}
