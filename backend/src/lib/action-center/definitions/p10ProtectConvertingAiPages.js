/**
 * P10 — Protect High-Converting AI Landing Pages.
 *
 * Signal: AI landing pages with key events beginning to lose their traffic.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'protect_converting_ai_pages',
  code: 'P10',
  version: 1,
  category: 'protect',
  name: 'Protect High-Converting AI Landing Pages',
  signalKinds: ['converting_page_slipping'],
  requires: ['analytics'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_ai_traffic',
    'analyze_ga4_outcomes',
    'analyze_visibility_change',
    'analyze_citations',
    'identify_target_pages',
    'optimize_content',
    'improve_cta_path',
    'validate_ai_traffic',
    'validate_ga4',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
