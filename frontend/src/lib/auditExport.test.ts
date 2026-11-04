// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AuditedPage } from '@/lib/actions/audits';
import {
  AUDIT_PAGES_CSV_HEADERS,
  auditPagesCsv,
  auditPagesExportFileName,
  auditPagesWorkbook,
  type AuditExportLabels,
} from './auditExport';

const labels: AuditExportLabels = {
  sheet: 'Pages',
  page: 'Page',
  score: 'Score',
  previousScore: 'Previous score',
  change: 'Change',
  status: 'Status',
  issues: 'Issues',
  lastAudit: 'Last audit',
  audits: 'Audits',
  firstScore: 'First score',
  firstAudit: 'First audit',
  changeSinceFirst: 'Change since first',
  statuses: {
    good: 'Good',
    improving: 'Improving',
    needs_work: 'Needs work',
    running: 'Running',
    failed: 'Failed',
  },
};

const page = (over: Partial<AuditedPage> = {}): AuditedPage => ({
  key: 'acme.com/pricing',
  host: 'acme.com',
  path: '/pricing',
  url: 'https://acme.com/pricing',
  auditId: 'a3',
  score: 0.634,
  previousScore: 0.58,
  firstScore: 0.5,
  firstAuditedAt: '2026-09-20T09:00:00+00:00',
  status: 'improving',
  lastAuditedAt: '2026-10-14T23:30:00+00:00',
  trend: [0.58, 0.634],
  issues: 14,
  runs: [],
  runCount: 3,
  ...over,
});

const failed = page({
  key: 'acme.com/broken',
  url: 'https://acme.com/broken,new',
  score: null,
  previousScore: null,
  firstScore: null,
  firstAuditedAt: null,
  status: 'failed',
  issues: null,
  runCount: 1,
});

describe('auditPagesCsv', () => {
  it('writes a row per page, scores out of 100 with their change, and the UTC day', () => {
    expect(auditPagesCsv([page(), failed], labels).split('\n')).toEqual([
      AUDIT_PAGES_CSV_HEADERS.join(','),
      'https://acme.com/pricing,63,58,5,Improving,14,2026-10-14,3,50,2026-09-20,13',
      '"https://acme.com/broken,new",,,,Failed,,2026-10-14,1,,,',
    ]);
  });

  it("keeps today's columns in their places and adds the first score after them", () => {
    expect(AUDIT_PAGES_CSV_HEADERS).toEqual([
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
    ]);
  });
});

describe('auditPagesWorkbook', () => {
  it('is one labelled sheet a spreadsheet reader opens', async () => {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const blob = await writeXlsxFile(auditPagesWorkbook([page(), failed], labels)).toBlob();
    const [sheet] = await readXlsxFile(blob);

    expect(sheet.sheet).toBe('Pages');
    expect(sheet.data).toEqual([
      [
        'Page',
        'Score',
        'Previous score',
        'Change',
        'Status',
        'Issues',
        'Last audit',
        'Audits',
        'First score',
        'First audit',
        'Change since first',
      ],
      [
        'https://acme.com/pricing',
        63,
        58,
        5,
        'Improving',
        14,
        '2026-10-14',
        3,
        50,
        '2026-09-20',
        13,
      ],
      [
        'https://acme.com/broken,new',
        null,
        null,
        null,
        'Failed',
        null,
        '2026-10-14',
        1,
        null,
        null,
        null,
      ],
    ]);
  });
});

describe('auditPagesExportFileName', () => {
  it("names the file after the day it's exported", () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(auditPagesExportFileName('csv', now)).toBe('site-audit-pages-2026-10-17.csv');
    expect(auditPagesExportFileName('xlsx', now)).toBe('site-audit-pages-2026-10-17.xlsx');
  });
});
