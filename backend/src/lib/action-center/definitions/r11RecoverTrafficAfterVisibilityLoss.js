/**
 * R11 — Recover Traffic After AI Visibility Loss.
 *
 * Signal: AI visibility and AI referral traffic falling in the same window. A
 * correlation, not a proven cause.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_traffic_after_visibility_loss',
  code: 'R11',
  version: 1,
  category: 'recover',
  name: 'Recover Traffic After AI Visibility Loss',
  signalKinds: ['visibility_traffic_loss'],
  requires: ['ai_traffic'],
  optional: ['analytics'],
  enabled: true,
  tasks: [
    'analyze_visibility_change',
    'analyze_ai_traffic',
    'analyze_ga4_outcomes',
    'analyze_citations',
    'identify_target_pages',
    'identify_content_gaps',
    'optimize_content',
    'validate_ai_visibility',
    'validate_ai_traffic',
    'validate_ga4',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
