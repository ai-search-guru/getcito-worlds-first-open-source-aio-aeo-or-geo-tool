'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/react';
import { Upload } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ATTACHMENT_ACCEPT,
  CONFIRM_TABLE_ROWS,
  MAX_ATTACHMENT_BYTES,
  attachmentKind,
  rowsThatFit,
  tableHtml,
  tableRows,
} from '@/lib/content/attachments';
import { MAX_BODY_HTML_LENGTH } from '@/lib/content/editor';
import { readDocumentFile } from '@/lib/content/importDocument';
import { formatNumber } from '@/lib/format';
import { cellsToText, parseCsv } from '@/lib/promptImport';

/** A spreadsheet waiting in the preview: its sheets, each as table rows. */
interface SheetFile {
  name: string;
  sheets: { name: string; rows: string[][] }[];
}

/** Rows the preview shows. */
const PREVIEW_ROWS = 10;

/**
 * Puts imported content where the cursor is, except inside a table: there it
 * goes under the table, as a table or a Word page in a cell would nest one in
 * another (and a table just inserted leaves the cursor in its last cell).
 */
function insertImported(editor: Editor, html: string) {
  const { $from } = editor.state.selection;
  let afterTable: number | null = null;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'table') afterTable = $from.after(depth);
  }
  const chain = editor.chain().focus();
  if (afterTable === null) chain.insertContent(html);
  else chain.insertContentAt(afterTable, html);
  chain.run();
}

/**
 * Attaching files to a draft (Content Editor CE-006, spec §9), from the
 * toolbar's Attach file or by dropping them on the page, up to 10 MB each:
 *
 *   * Excel (.xlsx) and CSV open a preview (the sheet, its first rows) and go
 *     in as a table, the first row as the header; over 200 rows asks first.
 *   * Markdown, HTML, Word (.docx) and text are imported where the cursor
 *     is, cleaned like a paste.
 *
 * Images wait for file storage; the old .xls and .doc formats are asked for
 * as .xlsx and .docx.
 */
export function useAttachments(editor: Editor | null) {
  const t = useTranslations('contentEditor.editor.attach');
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<SheetFile[]>([]);

  const insert = (html: string, name: string, note?: string) => {
    if (!editor) return;
    if (!html.trim()) {
      toast.error(t('empty', { name }));
      return;
    }
    insertImported(editor, html);
    toast.success(note ? `${t('imported', { name })} · ${note}` : t('imported', { name }));
  };

  const readOne = async (file: File) => {
    const name = file.name;
    const kind = attachmentKind(name);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('tooLarge', { name }));
      return;
    }
    switch (kind) {
      case 'spreadsheet': {
        // Loaded on demand: the readers are only needed when someone attaches.
        const { default: readXlsxFile } = await import('read-excel-file/browser');
        const sheets = (await readXlsxFile(file))
          .map((s) => ({ name: s.sheet, rows: tableRows(cellsToText(s.data as unknown[][])) }))
          .filter((s) => s.rows.length > 0);
        if (!sheets.length) toast.error(t('empty', { name }));
        else setQueue((q) => [...q, { name, sheets }]);
        return;
      }
      case 'csv': {
        const rows = tableRows(parseCsv(await file.text()));
        if (!rows.length) toast.error(t('empty', { name }));
        else setQueue((q) => [...q, { name, sheets: [{ name, rows }] }]);
        return;
      }
      case 'markdown':
      case 'html':
      case 'text':
      case 'word': {
        const doc = (await readDocumentFile(file))!;
        const note = doc.unsafeRemoved
          ? t('unsafeRemoved', { count: doc.unsafeRemoved })
          : doc.imagesRemoved
            ? t('imagesLeftOut', { count: doc.imagesRemoved })
            : undefined;
        insert(doc.html, name, note);
        return;
      }
      case 'image':
        toast.info(t('imageLater', { name }));
        return;
      case 'legacyOffice':
        toast.error(t('legacyOffice', { name }));
        return;
      default:
        toast.error(t('unsupported', { name }));
    }
  };

  const attach = async (files: File[]) => {
    for (const file of files) {
      try {
        await readOne(file);
      } catch (err) {
        console.error('Failed to attach a file:', err);
        toast.error(t('readFailed', { name: file.name }));
      }
    }
  };

  const insertTable = (rows: string[][], name: string) => {
    if (!editor) return;
    insertImported(editor, tableHtml(rows));
    toast.success(t('tableInserted', { name, count: rows.length - 1 }));
  };

  const ui = (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // The same file can be attached again.
          e.target.value = '';
          void attach(files);
        }}
      />
      {queue[0] && (
        <SheetPreviewDialog
          key={queue[0].name + queue.length}
          file={queue[0]}
          room={editor ? MAX_BODY_HTML_LENGTH - editor.getHTML().length : 0}
          onInsert={(rows) => insertTable(rows, queue[0].name)}
          onClose={() => setQueue((q) => q.slice(1))}
        />
      )}
    </>
  );

  return { open: () => inputRef.current?.click(), attach, ui };
}

/**
 * A sheet before it goes in: its first rows, and how many there are. A table
 * the page can't hold is cut to the rows that fit, said so first, since a
 * page over the size limit can't be saved; one with no room at all can't go
 * in.
 */
function SheetPreviewDialog({
  file,
  room,
  onInsert,
  onClose,
}: {
  file: SheetFile;
  /** Characters the page can still take before its size limit. */
  room: number;
  onInsert: (rows: string[][]) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.attach');
  const [sheetName, setSheetName] = useState(file.sheets[0].name);
  const [confirming, setConfirming] = useState(false);
  const sheet = file.sheets.find((s) => s.name === sheetName) ?? file.sheets[0];
  const dataRows = sheet.rows.length - 1;
  const [header, ...rest] = sheet.rows;
  const fit = rowsThatFit(sheet.rows, room);
  const noRoom = fit < 1 && dataRows > 0;
  const cut = !noRoom && fit < dataRows;
  const inserted = cut ? fit : dataRows;

  const insert = () => {
    if ((inserted > CONFIRM_TABLE_ROWS || cut) && !confirming) {
      setConfirming(true);
      return;
    }
    onInsert(sheet.rows.slice(0, inserted + 1));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.name}</DialogTitle>
          <DialogDescription>
            {t('previewSummary', {
              rows: formatNumber(dataRows),
              columns: formatNumber(header.length),
            })}
          </DialogDescription>
        </DialogHeader>
        {file.sheets.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('sheet')}</span>
            <Select
              value={sheetName}
              items={file.sheets.map((s) => ({ value: s.name, label: s.name }))}
              onValueChange={(v) => {
                if (!v) return;
                setSheetName(v);
                setConfirming(false);
              }}
            >
              <SelectTrigger className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {file.sheets.map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {header.map((cell, i) => (
                  <th key={i} className="whitespace-nowrap border-b px-2 py-1.5 font-medium">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rest.slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r} className="border-b last:border-0">
                  {row.map((cell, i) => (
                    <td key={i} className="max-w-[220px] truncate px-2 py-1.5">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dataRows > PREVIEW_ROWS && (
          <p className="text-xs text-muted-foreground">
            {t('previewMore', { count: formatNumber(dataRows - PREVIEW_ROWS) })}
          </p>
        )}
        {noRoom ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {t('noRoom')}
          </p>
        ) : (
          confirming && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              {cut
                ? t('confirmCut', { fit: formatNumber(fit), count: formatNumber(dataRows) })
                : t('confirmLong', { count: formatNumber(dataRows) })}
            </p>
          )
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={insert} disabled={noRoom}>
            {!confirming
              ? t('insertTable')
              : cut
                ? t('insertFirst', { count: formatNumber(fit) })
                : t('insertAll', { count: formatNumber(dataRows) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page under a drag with files: says they can be dropped. Pointer events
 * pass through, so the drop reaches the editor where the cursor should go.
 */
export function DropOverlay() {
  const t = useTranslations('contentEditor.editor.attach');
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-primary/40 bg-background/80 text-sm">
      <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium">{t('dropTitle')}</span>
      <span className="text-xs text-muted-foreground">{t('dropHint')}</span>
    </div>
  );
}
