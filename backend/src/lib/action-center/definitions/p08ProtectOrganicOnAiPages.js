/**
 * P08 — Protect Organic Traffic on AI-Exposed Pages.
 *
 * Signal: Queries earning organic clicks whose AI visibility is slipping.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_organic_on_ai_pages',
  code: 'P08',
  version: 1,
  category: 'protect',
  name: 'Protect Organic Traffic on AI-Exposed Pages',
  signalKinds: ['gsc_risk'],
  requires: ['tracking', 'search_console'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_gsc_demand',
    'identify_target_pages',
    'analyze_visibility_change',
    'analyze_citations',
    'analyze_competitor_visibility',
    'identify_content_gaps',
    'optimize_content',
    'validate_gsc',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
