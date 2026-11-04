/**
 * P09 — Protect Search & AI Traffic Assets.
 *
 * Signal: Organic clicks and AI referrals falling together.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_search_and_ai_assets',
  code: 'P09',
  version: 1,
  category: 'protect',
  name: 'Protect Search & AI Traffic Assets',
  signalKinds: ['cross_channel_risk'],
  requires: ['analytics', 'search_console'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_gsc_demand',
    'analyze_ai_traffic',
    'analyze_ga4_outcomes',
    'identify_target_pages',
    'analyze_visibility_change',
    'analyze_citations',
    'identify_content_gaps',
    'optimize_content',
    'validate_gsc',
    'validate_ai_traffic',
    'validate_ga4',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
