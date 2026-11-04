'use client';

/**
 * Add prompt → Bulk import (PROMPT-005): read a one-column .xlsx or .csv of
 * prompts in the browser, preview every row (valid, duplicate, error, over
 * the plan limit), then import the rows that fit in one locked server call.
 * Topic and location are set afterwards from each prompt's Edit.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileSpreadsheet, Info, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { formatNumber } from '@/lib/format';
import { importPrompts } from '@/lib/actions/prompt';
import {
  MAX_IMPORT_ROWS,
  TEMPLATE_HEADER,
  TEMPLATE_ROWS,
  buildPreview,
  cellsToText,
  parseCsv,
  rowsForCsv,
  type ImportRow,
} from '@/lib/promptImport';

interface Props {
  brandId: string;
  /** Prompt texts the brand already tracks, for duplicate detection. */
  existingTexts: string[];
  /** The dialog's platform and model selection, given to every imported prompt. */
  defaults: { platforms: string[]; models: string[] };
  /** The brand's location, given to every imported prompt. */
  defaultRegion: string;
  /** The plan's tracked-location cap and usage; null when unknown. */
  quota: { maxPrompts: number; used: number; planName: string; planId: string } | null;
  /** Upgrade / Contact us, as the Add prompt limit message shows them. */
  limitActions: React.ReactNode;
  onImported: () => void;
}

function downloadCsv(name: string, csv: string) {
  // BOM so Excel opens UTF-8 (Turkish characters) correctly.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_BADGE: Record<ImportRow['status'], { label: string; className: string }> = {
  valid: {
    label: 'Valid',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  duplicate: {
    label: 'Duplicate',
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
  error: {
    label: 'Error',
    className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  over_limit: {
    label: 'Over plan limit',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

export function BulkImportPrompts({
  brandId,
  existingTexts,
  defaults,
  defaultRegion,
  quota,
  limitActions,
  onImported,
}: Props) {
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const freeSlots =
    !quota || quota.maxPrompts === -1 ? -1 : Math.max(0, quota.maxPrompts - quota.used);

  const preview = useMemo(
    () => (sheet ? buildPreview(sheet, { existingTexts, freeSlots }) : null),
    [sheet, existingTexts, freeSlots],
  );

  const readFile = useCallback(async (file: File) => {
    setReadError(null);
    setSheet(null);
    setFileName(file.name);
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.csv')) {
        setSheet(parseCsv(await file.text()));
      } else if (name.endsWith('.xlsx')) {
        // Loaded on demand: the reader is only needed when someone imports.
        const { readSheet } = await import('read-excel-file/browser');
        setSheet(cellsToText((await readSheet(file)) as unknown[][]));
      } else {
        setReadError('Choose an .xlsx or .csv file.');
      }
    } catch {
      setReadError('This file could not be read. Check that it is a valid .xlsx or .csv file.');
    }
  }, []);

  const overRows = preview?.rows.filter((r) => r.status === 'over_limit') ?? [];
  const errorRows = preview?.rows.filter((r) => r.status === 'error') ?? [];
  const totalCandidates = (preview?.counts.valid ?? 0) + overRows.length;

  const handleImport = async () => {
    if (!preview || preview.importable.length === 0 || importing) return;
    setImporting(true);
    try {
      const result = await importPrompts(
        brandId,
        preview.importable.map((r, idx) => ({
          idx,
          text: r.text,
          topic: null,
          platforms: defaults.platforms,
          models: defaults.models,
          regions: [defaultRegion],
        })),
      );
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      const imported = result.importedIdx.length;
      const notImported = totalCandidates - imported;
      toast.success(
        notImported > 0
          ? `${imported} imported · ${notImported} not imported due to plan limit`
          : `${imported} prompt${imported === 1 ? '' : 's'} imported`,
        {
          description: result.analysisStarted
            ? 'Analyzing them now. Set topics and locations with Edit in All Prompts.'
            : 'They will be picked up by the next tracking run.',
        },
      );
      onImported();
    } catch {
      toast.error('Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const linkClass =
    'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          Put your prompts in <span className="font-medium text-foreground">one column</span>, one
          prompt per row, going down. A first row titled{' '}
          <span className="font-medium text-foreground">Prompt</span> is read as the header
          (optional). Imported prompts use the platforms selected under Single and the brand&apos;s
          location; set each one&apos;s topic and location afterwards with Edit in All Prompts.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        )}
      >
        {fileName && !readError ? (
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" />
        )}
        <p className="font-medium">
          {fileName ?? 'Drop an .xlsx or .csv file, or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground">
          One prompt per row · up to {formatNumber(MAX_IMPORT_ROWS)} rows
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => downloadCsv('prompts-template.csv', toCsv(TEMPLATE_ROWS, [TEMPLATE_HEADER]))}
        className={linkClass}
      >
        <Download className="h-3.5 w-3.5" />
        Download template
      </button>

      {readError && <p className="text-xs text-red-600 dark:text-red-400">{readError}</p>}

      {preview && (
        <>
          <p className="text-sm">
            <span className="font-medium">{preview.counts.valid} valid</span> ·{' '}
            {preview.counts.duplicates} duplicate{preview.counts.duplicates === 1 ? '' : 's'} ·{' '}
            {preview.counts.errors} error{preview.counts.errors === 1 ? '' : 's'}
            {quota && quota.maxPrompts !== -1 && (
              <span className="text-muted-foreground">
                {' '}
                · {quota.used} / {quota.maxPrompts} prompt locations in use
              </span>
            )}
          </p>
          {preview.truncated > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Only the first {formatNumber(MAX_IMPORT_ROWS)} rows were read;{' '}
              {formatNumber(preview.truncated)} more were left out. Split larger files.
            </p>
          )}
          {preview.extraColumns && (
            <p className="text-xs text-muted-foreground">
              Only the prompt column is read; the file&apos;s other columns were ignored.
            </p>
          )}

          {overRows.length > 0 && quota && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="space-y-2">
                <p className="text-amber-900 dark:text-amber-200">
                  {preview.counts.valid === 0
                    ? `No prompts can be imported. Your ${quota.planName} plan tracks up to ${quota.maxPrompts} prompt locations and ${quota.used} are already in use.`
                    : `Only ${preview.counts.valid} of ${totalCandidates} prompts will be imported. Your ${quota.planName} plan tracks up to ${quota.maxPrompts} prompt locations and ${quota.used} are already in use. The remaining ${overRows.length} prompt${overRows.length === 1 ? '' : 's'} (from row ${overRows[0].row}) won't be imported.`}{' '}
                  To add more prompts,{' '}
                  {quota.planId === 'starter' ? 'upgrade your plan' : 'contact us'}.
                </p>
                <div className="flex flex-wrap gap-2">{limitActions}</div>
              </div>
            </div>
          )}

          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="w-12 px-2 py-1.5 font-medium">Row</th>
                  <th className="px-2 py-1.5 font-medium">Prompt</th>
                  <th className="w-40 px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className="border-t align-top">
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                    <td className="px-2 py-1.5 break-words">{r.text || '—'}</td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', STATUS_BADGE[r.status].className)}
                      >
                        {STATUS_BADGE[r.status].label}
                      </Badge>
                      {r.reason && r.status !== 'over_limit' && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{r.reason}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3">
              {overRows.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      'prompts-not-imported.csv',
                      toCsv(rowsForCsv(overRows, false), [TEMPLATE_HEADER]),
                    )
                  }
                  className={linkClass}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download not-imported prompts (.csv)
                </button>
              )}
              {errorRows.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      'prompts-errors.csv',
                      toCsv(rowsForCsv(errorRows, true), [TEMPLATE_HEADER, 'reason']),
                    )
                  }
                  className={linkClass}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download errors (.csv)
                </button>
              )}
            </div>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing || preview.counts.valid === 0}
            >
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import {preview.counts.valid} prompt{preview.counts.valid === 1 ? '' : 's'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
