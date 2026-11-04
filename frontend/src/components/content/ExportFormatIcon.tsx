import {
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  Sheet,
  type LucideIcon,
} from 'lucide-react';
import type { DraftExportFormat } from '@/lib/content/draftExport';
import { cn } from '@/lib/utils';

/** Each export format's icon, in the colour its app is known by. */
const FORMAT_ICONS: Record<DraftExportFormat, { icon: LucideIcon; className: string }> = {
  docx: { icon: FileType, className: 'text-blue-600 dark:text-blue-400' },
  xlsx: { icon: FileSpreadsheet, className: 'text-emerald-600 dark:text-emerald-400' },
  csv: { icon: Sheet, className: 'text-teal-600 dark:text-teal-400' },
  html: { icon: FileCode, className: 'text-orange-600 dark:text-orange-400' },
  md: { icon: FileText, className: 'text-muted-foreground' },
};

/**
 * An export format's icon, wherever a page or a list is exported (the
 * editor's Export, the Library's): in its colour, or in the text's own on a
 * picked pill (`plain`).
 */
export function ExportFormatIcon({
  format,
  plain = false,
  className,
}: {
  format: DraftExportFormat;
  plain?: boolean;
  className?: string;
}) {
  const { icon: Icon, className: colour } = FORMAT_ICONS[format];
  return <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', !plain && colour, className)} />;
}
