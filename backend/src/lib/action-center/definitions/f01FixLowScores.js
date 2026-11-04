/**
 * F01 — Fix Low AI-Readiness Pages.
 *
 * Signal: Pages whose Site Audit score is below threshold.
 *
 * Version 2: the task plan now follows the specification's library, and the
 * payload names its targets.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_low_scores',
  code: 'F01',
  version: 2,
  category: 'fix',
  name: 'Fix Low AI-Readiness Pages',
  signalKinds: ['audit_low_score'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_site_audit',
    'prioritize_targets',
    { branch: [['fix_technical_issue'], ['optimize_content']] },
    'validate_technical_fix',
    'measure_action_outcome',
  ],

  payload(byKind) {
    // The count is the list the action keeps (AC-009), as g01's.
    const base = targetPayload(byKind, 'pages');
    return { ...base, pageCount: base.targetCount };
  },
};
