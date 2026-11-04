'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { getAuditPages, type AuditedPage } from '@/lib/actions/audits';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import {
  auditPagesCsv,
  auditPagesExportFileName,
  auditPagesWorkbook,
  type AuditExportLabels,
} from '@/lib/auditExport';
import { saveBlob } from '@/lib/download';
import type { ExportFormat } from './_BulkBar';

/** The server's largest page of the Pages list. */
const EXPORT_PAGE_SIZE = 100;

/** Every audited page of the brand, read page by page. */
export async function readAllPages(brandId: string): Promise<AuditedPage[]> {
  const all: AuditedPage[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const { pages, total } = await getAuditPages(brandId, offset, EXPORT_PAGE_SIZE);
    // A page audited meanwhile moves to the top and can repeat at a boundary.
    for (const page of pages) {
      if (!seen.has(page.key)) {
        seen.add(page.key);
        all.push(page);
      }
    }
    if (pages.length < EXPORT_PAGE_SIZE || offset + EXPORT_PAGE_SIZE >= total) return all;
  }
}

/** Export CSV / Excel of the Pages table: all pages, or the ones given. */
export function usePagesExport(brandId: string | null) {
  const t = useTranslations('audit');
  const [exporting, setExporting] = useState(false);

  const labels = (): AuditExportLabels => ({
    sheet: t('export.sheet'),
    page: t('pages.page'),
    score: t('pages.score'),
    previousScore: t('export.previousScore'),
    change: t('export.change'),
    status: t('pages.status'),
    issues: t('pages.issues'),
    lastAudit: t('pages.lastAudit'),
    audits: t('export.audits'),
    firstScore: t('export.firstScore'),
    firstAudit: t('export.firstAudit'),
    changeSinceFirst: t('export.changeSinceFirst'),
    statuses: {
      good: t('pages.statuses.good'),
      improving: t('pages.statuses.improving'),
      needs_work: t('pages.statuses.needs_work'),
      running: t('pages.statuses.running'),
      failed: t('pages.statuses.failed'),
    },
  });

  const download = async (pages: AuditedPage[], format: ExportFormat) => {
    if (format === 'csv') {
      saveBlob(
        new Blob([BYTE_ORDER_MARK, auditPagesCsv(pages, labels())], {
          type: 'text/csv;charset=utf-8;',
        }),
        auditPagesExportFileName('csv'),
      );
      return;
    }
    // Loaded on demand: the writer is only needed when someone asks for a file.
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    await writeXlsxFile(auditPagesWorkbook(pages, labels())).toFile(
      auditPagesExportFileName('xlsx'),
    );
  };

  const run = async (read: () => Promise<AuditedPage[]>, format: ExportFormat) => {
    setExporting(true);
    try {
      await download(await read(), format);
    } catch (err) {
      console.error('Site Audit export failed:', err);
      toast.error(t('export.failed'));
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    exportAll: (format: ExportFormat) => {
      if (brandId) void run(() => readAllPages(brandId), format);
    },
    exportPages: (pages: AuditedPage[], format: ExportFormat) =>
      void run(async () => pages, format),
  };
}
