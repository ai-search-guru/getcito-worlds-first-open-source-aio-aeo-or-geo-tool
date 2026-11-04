/**
 * G12 — Convert Search Demand into AI Visibility.
 *
 * Signal: Strong Search Console demand where the related AI prompts show no
 * visibility.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'convert_search_demand',
  code: 'G12',
  version: 1,
  category: 'growth',
  name: 'Convert Search Demand into AI Visibility',
  signalKinds: ['gsc_demand_gap'],
  requires: ['tracking', 'search_console'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_gsc_demand',
    'map_queries_to_prompts',
    'prioritize_targets',
    'analyze_prompt_gap',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_ai_visibility',
    'validate_gsc',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
