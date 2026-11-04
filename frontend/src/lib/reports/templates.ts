/**
 * Report template registry (US-1.1/1.3) — ready-made report shapes a user
 * can generate without building anything from scratch. A template is a
 * DEFAULT section set: the generate dialog pre-selects its sections and the
 * user can toggle any module on/off before generating (US-1.3). Since the
 * detail page and the PDF both render by payload-field presence, the chosen
 * sections are exactly what shows up in the output. Names/descriptions live
 * in the `reports` i18n namespace under `templates.<id>.*` / `sections.*`.
 *
 * Template ids are persisted in `reports.template`, so they are part of the
 * data contract: never rename an id, only add new ones. `executive_summary`
 * predates this registry (Simple Reports MVP) and stays the full report.
 */

export type ReportTemplateId =
  | 'weekly_visibility'
  | 'executive_summary'
  | 'competitor_benchmark'
  | 'citation_sources';

export type ReportSection =
  | 'kpis'
  | 'trend'
  | 'shareOfVoice'
  | 'competitors'
  | 'topicPerformance'
  | 'promptPerformance'
  | 'mentionEvidence'
  | 'queryFanout'
  | 'aiTraffic'
  | 'shoppingVisibility'
  | 'auditScore'
  | 'citations'
  | 'citationEvidence';

/**
 * Every pickable section, in report render order — drives the section
 * checkboxes in the generate dialog. `shoppingVisibility` is additionally
 * gated on the brand's shopping mode (hidden entirely when off, mirroring
 * the sidebar's `requiresBrandPref` rule).
 */
export const ALL_REPORT_SECTIONS: ReportSection[] = [
  'kpis',
  'trend',
  'shareOfVoice',
  'competitors',
  'topicPerformance',
  'promptPerformance',
  'mentionEvidence',
  'queryFanout',
  'aiTraffic',
  'shoppingVisibility',
  'auditScore',
  'citations',
  'citationEvidence',
];

export interface ReportTemplateDef {
  id: ReportTemplateId;
  /** Default payload sections (AI summary is always included); user-adjustable in the dialog. */
  sections: ReportSection[];
  /** Date-range preset the generate dialog starts on (user can still override). */
  defaultPreset: '7d' | '30d' | '90d';
}

export const REPORT_TEMPLATES: ReportTemplateDef[] = [
  {
    id: 'weekly_visibility',
    sections: ['kpis', 'trend', 'shareOfVoice'],
    defaultPreset: '7d',
  },
  {
    id: 'executive_summary',
    sections: [
      'kpis',
      'trend',
      'shareOfVoice',
      'competitors',
      'topicPerformance',
      'promptPerformance',
      'mentionEvidence',
      'queryFanout',
      'aiTraffic',
      'shoppingVisibility',
      'auditScore',
      'citations',
      'citationEvidence',
    ],
    defaultPreset: '30d',
  },
  {
    id: 'competitor_benchmark',
    sections: ['kpis', 'shareOfVoice', 'competitors', 'topicPerformance'],
    defaultPreset: '30d',
  },
  {
    id: 'citation_sources',
    sections: ['citations', 'citationEvidence'],
    defaultPreset: '30d',
  },
];

/** Falls back to the full executive summary for unknown/legacy ids. */
export function getReportTemplate(id: string | null | undefined): ReportTemplateDef {
  return (
    REPORT_TEMPLATES.find((t) => t.id === id) ??
    REPORT_TEMPLATES.find((t) => t.id === 'executive_summary')!
  );
}
