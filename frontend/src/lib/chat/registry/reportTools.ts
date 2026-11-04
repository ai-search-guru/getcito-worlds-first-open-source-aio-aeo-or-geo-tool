import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import { createReport } from '@/lib/actions/reports';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { FIXTURE_IDS, defineTool } from './defineTool';

/**
 * Chat's report WRITE row (CHAT-20 §9 row 64): a report made as the Reports
 * page makes one (createReport: a template over a period), as the signed-in
 * member. Admins and Managers (DECISIONS T).
 */

const BRAND = FIXTURE_IDS.brand;

const TEMPLATES = [
  'weekly_visibility',
  'executive_summary',
  'competitor_benchmark',
  'citation_sources',
] as const;

const templateT = createTranslator({ locale: 'en', messages, namespace: 'reports.templates' });

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('A day, YYYY-MM-DD.');

export const REPORT_TOOLS = [
  defineTool({
    name: 'build_report',
    class: 'write',
    area: 'reports',
    description:
      "Make a report of the brand in Reports, from one of its templates over a period: weekly_visibility (KPIs, trend, share of voice), executive_summary (every section), competitor_benchmark or citation_sources. It's kept in Reports to open, share or download.",
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
    minRole: 'manager',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C2',
    labelKey: 'makeReport',
    route: '/dashboard/reports',
    mcpTool: null,
    specRow: '64',
    inputSchema: z
      .object({
        brand_id: contentUuid.describe('Brand id, from list_brands.'),
        template: z.enum(TEMPLATES),
        date_from: day,
        date_to: day,
      })
      .refine((input) => input.date_from <= input.date_to, {
        message: 'The period ends on or after its start.',
      }),
    run: (_ctx, input) =>
      createReport(input.brand_id, {
        dateFrom: input.date_from,
        dateTo: input.date_to,
        template: input.template,
      }),
    target: (input) =>
      `${templateT(`${input.template}.name`)} · ${input.date_from} – ${input.date_to}`,
    fixture: {
      input: {
        brand_id: BRAND,
        template: 'weekly_visibility',
        date_from: '2026-10-01',
        date_to: '2026-10-07',
      },
    },
  }),
];
