import type { Sheet } from 'write-excel-file/browser';
import type { AuditedPage, AuditedPageStatus } from '@/lib/actions/audits';
import { toCsv } from '@/lib/csv';

/**
 * Site Audit's Pages export (SA-003): a row per audited page, as CSV or Excel,
 * for all pages or the selected ones. The first score, when it ran and the
 * change since come last, so the columns before keep their places.
 */

export interface AuditExportLabels {
  sheet: string;
  page: string;
  score: string;
  previousScore: string;
  change: string;
  status: string;
  issues: string;
  lastAudit: string;
  audits: string;
  firstScore: string;
  firstAudit: string;
  changeSinceFirst: string;
  statuses: Record<AuditedPageStatus, string>;
}

export const AUDIT_PAGES_CSV_HEADERS = [
  'page_url',
  'score',
  'previous_score',
  'change',
  'status',
  'issues',
  'last_audit',
  'audits',
  'first_score',
  'first_audit',
  'change_since_first',
];

const points = (score: number | null) => (score === null ? null : Math.round(score * 100));
/** The UTC day, which a spreadsheet sorts and reads in any locale. */
const day = (at: string) => new Date(at).toISOString().slice(0, 10);

function exportRow(page: AuditedPage, labels: AuditExportLabels) {
  const score = points(page.score);
  const previous = points(page.previousScore);
  const first = points(page.firstScore);
  return {
    page_url: page.url,
    score,
    previous_score: previous,
    change: score !== null && previous !== null ? score - previous : null,
    status: labels.statuses[page.status],
    issues: page.issues,
    last_audit: day(page.lastAuditedAt),
    audits: page.runCount,
    first_score: first,
    first_audit: page.firstAuditedAt ? day(page.firstAuditedAt) : null,
    change_since_first: score !== null && first !== null ? score - first : null,
  };
}

/** The Pages export as CSV, without the byte order mark the download adds. */
export function auditPagesCsv(pages: AuditedPage[], labels: AuditExportLabels): string {
  return toCsv(
    pages.map((page) => exportRow(page, labels)),
    AUDIT_PAGES_CSV_HEADERS,
  );
}

const bold = (value: string) => ({ value, fontWeight: 'bold' as const });

/** The Pages export as one Excel sheet, labelled in the reader's language. */
export function auditPagesWorkbook(pages: AuditedPage[], labels: AuditExportLabels): Sheet<Blob>[] {
  return [
    {
      sheet: labels.sheet,
      stickyRowsCount: 1,
      columns: [
        { width: 60 },
        { width: 8 },
        { width: 14 },
        { width: 8 },
        { width: 12 },
        { width: 8 },
        { width: 12 },
        { width: 8 },
        { width: 12 },
        { width: 12 },
        { width: 18 },
      ],
      data: [
        [
          labels.page,
          labels.score,
          labels.previousScore,
          labels.change,
          labels.status,
          labels.issues,
          labels.lastAudit,
          labels.audits,
          labels.firstScore,
          labels.firstAudit,
          labels.changeSinceFirst,
        ].map(bold),
        ...pages.map((page) => Object.values(exportRow(page, labels))),
      ],
    },
  ];
}

/** "site-audit-pages-2026-10-17.csv" */
export function auditPagesExportFileName(ext: 'csv' | 'xlsx', now = new Date()): string {
  return `site-audit-pages-${now.toISOString().slice(0, 10)}.${ext}`;
}
