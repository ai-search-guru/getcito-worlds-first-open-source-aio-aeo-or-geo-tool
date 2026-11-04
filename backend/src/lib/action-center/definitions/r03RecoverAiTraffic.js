/**
 * R03 — Recover AI Traffic.
 *
 * Signal: AI referral traffic falling significantly: over two weeks against
 * the two before, or by 40% week over week (AT-013, spec §3.8).
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_ai_traffic',
  code: 'R03',
  version: 1,
  category: 'recover',
  name: 'Recover AI Traffic',
  signalKinds: ['ai_traffic_drop', 'ai_visits_weekly_drop'],
  requires: ['ai_traffic'],
  optional: ['analytics'],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_visibility_change',
    'analyze_citations',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'identify_content_gaps',
    'optimize_content',
    'validate_ai_traffic',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
