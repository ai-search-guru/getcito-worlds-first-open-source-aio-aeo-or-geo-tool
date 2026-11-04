/**
 * P03 — Protect AI Traffic Pages.
 *
 * Signal: AI referral pages beginning to lose traffic.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_ai_traffic_pages',
  code: 'P03',
  version: 1,
  category: 'protect',
  name: 'Protect AI Traffic Pages',
  signalKinds: ['ai_traffic_slipping'],
  requires: ['ai_traffic'],
  optional: ['analytics'],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_visibility_change',
    'analyze_citations',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'optimize_content',
    'validate_ai_traffic',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
