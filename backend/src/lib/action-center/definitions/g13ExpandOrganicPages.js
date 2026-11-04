/**
 * G13 — Expand High-Performing Organic Pages into AI.
 *
 * Signal: Strong organic pages with weak AI visibility.
 *
 * Disabled. The Search Console sync stores queries, not pages, so there is no
 * organic page performance to compare against. Registered; enabled once
 * page-level sync exists.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'expand_organic_pages',
  code: 'G13',
  version: 1,
  category: 'growth',
  name: 'Expand High-Performing Organic Pages into AI',
  signalKinds: ['gsc_page_gap'],
  requires: ['tracking', 'search_console'],
  optional: [],
  enabled: false,
  disabledReason:
    'The Search Console sync stores queries, not pages, so there is no organic page performance to compare against. Registered; enabled once page-level sync exists.',
  tasks: [
    'analyze_gsc_demand',
    'identify_target_pages',
    'map_queries_to_prompts',
    'analyze_prompt_gap',
    'analyze_citations',
    'identify_content_gaps',
    'optimize_content',
    'validate_ai_visibility',
    'validate_citations',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
