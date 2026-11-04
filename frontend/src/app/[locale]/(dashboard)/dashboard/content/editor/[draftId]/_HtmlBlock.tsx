'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Code2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatNumber } from '@/lib/format';
import { MAX_HTML_BLOCK_LENGTH } from '@/lib/content/htmlAllowlist';
import { cn } from '@/lib/utils';
import { HtmlBlockNode } from '@/lib/content/htmlBlockNode';

/**
 * HTML blocks (the user's request beside CE-020, as Webflow's custom code in
 * rich text): code the page carries as written, a widget, an embed, a form,
 * as many as the page needs. GetCito never runs it: the editor shows it as
 * text, the draft stores it encoded (htmlAllowlist.ts), and Copy HTML gives
 * it back unchanged.
 */
export const HtmlBlock = HtmlBlockNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(HtmlBlockView);
  },
});

/**
 * The browser's older copy command, for when the Clipboard API is refused
 * (no permission, an embedded or insecure page): a hidden field holding the
 * text, selected and copied.
 */
function copyWithSelection(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/** Puts text on the clipboard and says so. */
export async function copyToClipboard(text: string, copied: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(copied);
  } catch {
    if (copyWithSelection(text)) toast.success(copied);
    else toast.error(failed);
  }
}

const PREVIEW_LINES = 6;

function HtmlBlockView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const t = useTranslations('contentEditor.editor.htmlBlock');
  const [editing, setEditing] = useState(false);
  const code = node.attrs.code as string;
  const lines = code.split('\n');
  const preview = lines.slice(0, PREVIEW_LINES).join('\n');

  return (
    <NodeViewWrapper className="not-prose my-4" data-html-block-view="">
      <div
        contentEditable={false}
        className={cn(
          'overflow-hidden rounded-md border bg-muted/30',
          selected && 'ring-2 ring-ring/50',
        )}
      >
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <Code2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{t('label')}</span>
          <span className="text-muted-foreground">{t('lines', { count: lines.length })}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              {t('edit')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="gap-1"
              onClick={() => void copyToClipboard(code, t('copied'), t('copyFailed'))}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              {t('copy')}
            </Button>
          </div>
        </div>
        {/* Text, never markup: React escapes it. */}
        <pre className="m-0 max-h-40 overflow-hidden whitespace-pre-wrap break-all bg-transparent px-3 py-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
          {preview}
          {lines.length > PREVIEW_LINES && '\n…'}
        </pre>
      </div>
      {editing && (
        <HtmlBlockDialog
          initial={code}
          onSave={(next) => updateAttributes({ code: next })}
          onRemove={deleteNode}
          onClose={() => setEditing(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

/**
 * Write or change an HTML block's code: what the toolbar's HTML block opens
 * (no `onRemove`), and Edit on a block.
 */
export function HtmlBlockDialog({
  initial,
  onSave,
  onRemove,
  onClose,
}: {
  initial: string;
  onSave: (code: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.htmlBlock');
  const [code, setCode] = useState(initial);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const tooLong = code.length > MAX_HTML_BLOCK_LENGTH;
  const empty = !code.trim();

  const save = () => {
    if (tooLong || empty) return;
    onSave(code);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      {/* The code field takes the focus, not the dialog's close button. */}
      <DialogContent className="sm:max-w-2xl" initialFocus={codeRef}>
        <DialogHeader>
          <DialogTitle>{onRemove ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <textarea
          ref={codeRef}
          value={code}
          spellCheck={false}
          aria-label={t('codeLabel')}
          placeholder={t('placeholder', {
            example: '<iframe src="https://www.youtube.com/embed/…"></iframe>',
          })}
          onChange={(e) => setCode(e.target.value)}
          className="h-72 w-full resize-y rounded-md border bg-muted/20 px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <p
          className={cn(
            'text-right text-xs tabular-nums text-muted-foreground',
            tooLong && 'text-destructive',
          )}
        >
          {tooLong
            ? t('tooLong', { max: formatNumber(MAX_HTML_BLOCK_LENGTH) })
            : t('count', {
                count: formatNumber(code.length),
                max: formatNumber(MAX_HTML_BLOCK_LENGTH),
              })}
        </p>
        <DialogFooter>
          {onRemove && (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground hover:text-destructive"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              {t('remove')}
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button disabled={tooLong || empty} onClick={save}>
            {onRemove ? t('save') : t('insert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
