'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportFormatIcon } from '@/components/content/ExportFormatIcon';
import { DRAFT_EXPORT_FORMATS, type DraftExportFormat } from '@/lib/content/draftExport';

/**
 * Export in the editor's header: the page as written now, as Word, Excel,
 * CSV, HTML or Markdown. Labelled from a tablet's width up, so it is there
 * to find; an icon on a phone, where the header's one row has no room for
 * the word.
 */
export function ExportMenu({
  disabled,
  onExport,
}: {
  disabled: boolean;
  onExport: (format: DraftExportFormat) => void;
}) {
  const t = useTranslations('contentEditor.editor.export');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={disabled}
        title={t('hint')}
        aria-label={t('button')}
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('button')}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {DRAFT_EXPORT_FORMATS.map((format) => (
          <DropdownMenuItem key={format} className="gap-2" onClick={() => onExport(format)}>
            <ExportFormatIcon format={format} />
            {t(format)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
