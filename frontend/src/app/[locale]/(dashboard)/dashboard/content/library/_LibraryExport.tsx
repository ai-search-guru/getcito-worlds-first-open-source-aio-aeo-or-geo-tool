'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Download } from 'lucide-react';
import { ExportFormatIcon } from '@/components/content/ExportFormatIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingDots } from '@/components/ui/loading-dots';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import { assigneeLabel } from '@/lib/action-center/display';
import { getContentDraftPages, type DraftPage } from '@/lib/actions/contentDrafts';
import { publishableHtml } from '@/lib/content/cleanHtml';
import {
  draftExportBlob,
  draftExportFileName,
  libraryCsv,
  libraryDocx,
  libraryExportFileName,
  libraryWorkbook,
  type DraftExportFormat,
  type LibraryExportFormat,
  type LibraryExportItem,
} from '@/lib/content/draftExport';
import {
  DRAFT_PAGES_PER_CALL,
  type ContentDraftListItem,
  type LibraryTab,
} from '@/lib/content/drafts';
import { saveBlob } from '@/lib/download';
import { exportAuthor, exportFileWord } from '@/lib/white-label/exportName';

/**
 * The Library's Export (CE-002): the drafts listed (the tab, within the
 * Created range) with their pages, as one Word document, an Excel sheet or
 * a CSV; and one draft from its row, as the editor's Export does.
 */
export function useLibraryExport(brandId: string | null) {
  const t = useTranslations('contentEditor.library');
  const tStatus = useTranslations('contentEditor.status');
  const tMethod = useTranslations('contentEditor.method');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const [exporting, setExporting] = useState(false);

  const titleOf = (draft: ContentDraftListItem) => draft.title.trim() || t('untitled');
  const item = (draft: ContentDraftListItem, page: DraftPage): LibraryExportItem => ({
    title: titleOf(draft),
    status: tStatus(draft.status),
    method: tMethod(draft.method),
    pageType: draft.pageType
      ? tTypes.has(draft.pageType)
        ? tTypes(draft.pageType)
        : draft.pageType
      : '',
    author:
      draft.author === 'agent'
        ? t('contentAgent')
        : ((draft.createdBy && assigneeLabel(draft.createdBy)) ?? t('formerMember')),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    url: page.sourceUrl,
    html: publishableHtml(page.bodyHtml),
  });

  const exportList = async (
    drafts: ContentDraftListItem[],
    tab: LibraryTab,
    format: LibraryExportFormat,
  ) => {
    if (!brandId || drafts.length === 0) return;
    setExporting(true);
    try {
      // A call's pages come back whole, so the list is read a slice at a
      // time; ids a call left for its response's size go first in the next.
      const pages = new Map<string, DraftPage>();
      let queue = drafts.map((d) => d.id);
      while (queue.length > 0) {
        const read = await getContentDraftPages(brandId, queue.slice(0, DRAFT_PAGES_PER_CALL));
        for (const page of read.pages) pages.set(page.id, page);
        queue = [...read.rest, ...queue.slice(DRAFT_PAGES_PER_CALL)];
      }
      const items = drafts.flatMap((draft) => {
        const page = pages.get(draft.id);
        return page ? [item(draft, page)] : [];
      });
      const fileName = libraryExportFileName(tab, format, new Date(), await exportFileWord());
      if (format === 'csv') {
        saveBlob(
          new Blob([BYTE_ORDER_MARK, libraryCsv(items)], { type: 'text/csv;charset=utf-8;' }),
          fileName,
        );
      } else if (format === 'xlsx') {
        // Loaded on the click: the library is only needed to write the file.
        const { default: writeXlsxFile } = await import('write-excel-file/browser');
        await writeXlsxFile(libraryWorkbook(items)).toFile(fileName);
      } else {
        saveBlob(await libraryDocx(items, await exportAuthor()), fileName);
      }
    } catch (err) {
      console.error('Failed to export the Library:', err);
      toast.error(t('export.failed'));
    } finally {
      setExporting(false);
    }
  };

  const exportDraft = async (draft: ContentDraftListItem, format: DraftExportFormat) => {
    if (!brandId) return;
    try {
      const {
        pages: [page],
      } = await getContentDraftPages(brandId, [draft.id]);
      if (!page) throw new Error('not_found');
      const title = titleOf(draft);
      saveBlob(
        await draftExportBlob(
          format,
          title,
          publishableHtml(page.bodyHtml),
          undefined,
          page.sourceUrl,
          await exportAuthor(),
        ),
        draftExportFileName(title, format, await exportFileWord()),
      );
    } catch (err) {
      console.error('Failed to export the draft:', err);
      toast.error(t('export.failed'));
    }
  };

  return { exporting, exportList, exportDraft };
}

/** The formats, in the order the editor's Export lists them. */
const FORMATS = ['docx', 'xlsx', 'csv'] as const satisfies readonly LibraryExportFormat[];

/** Export in the Library's header: the drafts listed, as Word, Excel or CSV. */
export function LibraryExportMenu({
  disabled,
  exporting,
  onExport,
}: {
  disabled: boolean;
  exporting: boolean;
  onExport: (format: LibraryExportFormat) => void;
}) {
  const t = useTranslations('contentEditor.library.export');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="gap-2" />}
        disabled={disabled || exporting}
        title={t('hint')}
      >
        {exporting ? <LoadingDots /> : <Download className="h-4 w-4" />}
        {t('button')}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {FORMATS.map((format) => (
          <DropdownMenuItem key={format} className="gap-2" onClick={() => onExport(format)}>
            <ExportFormatIcon format={format} />
            {t(format)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
