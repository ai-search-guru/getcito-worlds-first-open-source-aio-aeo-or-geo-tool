'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Download, FileArchive, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatNumber } from '@/lib/format';
import { exportFileName } from '@/lib/white-label/exportName';
import type { TrafficDateWindow } from '@/lib/actions/traffic';
import { TRAFFIC_EXPORT_MAX_ROWS, type TrafficExportSection } from '@/lib/trafficExport';

/**
 * Downloads from GET /api/traffic/export (AT-015): the whole page from the
 * header's Export menu, one table from its own Excel / CSV buttons. The file
 * is built on the server; this fetches it, so a refusal (too many rows) or a
 * failure shows as a toast instead of replacing the page.
 */

export type ExportFormat = 'xlsx' | 'zip' | 'csv';

export interface TrafficExporter {
  /** What is being exported, e.g. "zip" or "visits:csv"; null when idle. */
  busy: string | null;
  run: (format: ExportFormat, section?: TrafficExportSection) => Promise<void>;
}

/** The file name the route gave, from `attachment; filename="…"`. */
export function attachmentName(header: string | null): string | null {
  return header?.match(/filename="([^"]+)"/)?.[1] ?? null;
}

export function useTrafficExport({
  brandId,
  dateWindow,
  rangeLabel,
  platform,
  search,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  rangeLabel: string;
  /** The visit list's filters; they apply to its rows. */
  platform: string;
  search: string;
}): TrafficExporter {
  const t = useTranslations('traffic.export');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(format: ExportFormat, section?: TrafficExportSection) {
    const params = new URLSearchParams({ brandId, format, rangeLabel });
    if (dateWindow.dateFrom) params.set('from', dateWindow.dateFrom);
    if (dateWindow.dateTo) params.set('to', dateWindow.dateTo);
    if (platform) params.set('platform', platform);
    if (search) params.set('search', search);
    if (section) params.set('section', section);

    setBusy(section ? `${section}:${format}` : format);
    try {
      const res = await fetch(`/api/traffic/export?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(
          body.error === 'too_large'
            ? t('tooLarge', { max: formatNumber(TRAFFIC_EXPORT_MAX_ROWS) })
            : t('failed'),
        );
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download =
        attachmentName(res.headers.get('Content-Disposition')) ??
        (await exportFileName(`ai-traffic.${format}`, '-'));
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return { busy, run };
}

/** The header's Export menu: the whole page as Excel, or as a zip of CSVs. */
export function ExportMenu({
  exporter,
  disabled,
}: {
  exporter: TrafficExporter;
  disabled?: boolean;
}) {
  const t = useTranslations('traffic.export');
  const working = exporter.busy === 'xlsx' || exporter.busy === 'zip';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="gap-2"
            disabled={disabled || exporter.busy !== null}
          />
        }
      >
        {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {working ? t('exporting') : t('button')}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => void exporter.run('xlsx')}>
          <FileSpreadsheet className="mr-2 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('excel')}</div>
            <div className="text-xs text-muted-foreground">{t('excelHint')}</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exporter.run('zip')}>
          <FileArchive className="mr-2 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">{t('csv')}</div>
            <div className="text-xs text-muted-foreground">{t('csvHint')}</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A table's own Excel / CSV buttons, beside its title. */
export function TableExport({
  exporter,
  section,
}: {
  exporter: TrafficExporter;
  section: TrafficExportSection;
}) {
  const t = useTranslations('traffic.export');
  const button = (format: 'xlsx' | 'csv', text: string) => {
    const working = exporter.busy === `${section}:${format}`;
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        disabled={exporter.busy !== null}
        onClick={() => void exporter.run(format, section)}
      >
        {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {text}
      </Button>
    );
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {button('xlsx', t('tableExcel'))}
      {button('csv', t('tableCsv'))}
    </div>
  );
}
