/**
 * F03 — Fix Structured Data Issues.
 *
 * Signal: Structured data missing or invalid on audited pages.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_structured_data',
  code: 'F03',
  version: 1,
  category: 'fix',
  name: 'Fix Structured Data Issues',
  signalKinds: ['structured_data_issue'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_site_audit',
    'identify_target_pages',
    'fix_structured_data',
    'validate_technical_fix',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
