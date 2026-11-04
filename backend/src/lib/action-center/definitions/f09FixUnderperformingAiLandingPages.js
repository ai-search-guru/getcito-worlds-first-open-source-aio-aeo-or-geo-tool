/**
 * F09 — Fix Underperforming AI Landing Pages.
 *
 * Signal: AI traffic arriving, and engaging well below the site rate.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_underperforming_ai_landing_pages',
  code: 'F09',
  version: 1,
  category: 'fix',
  name: 'Fix Underperforming AI Landing Pages',
  signalKinds: ['ai_landing_underperforming'],
  requires: ['analytics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'analyze_ai_responses',
    'identify_content_gaps',
    'optimize_content',
    'improve_cta_path',
    'publish_content',
    'validate_ai_traffic',
    'validate_ga4',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
