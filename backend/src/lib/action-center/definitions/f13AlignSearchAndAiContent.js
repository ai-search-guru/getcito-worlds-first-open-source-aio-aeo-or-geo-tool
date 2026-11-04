/**
 * F13 — Fix Search-to-AI Content Misalignment.
 *
 * Signal: Queries the brand ranks in the top three for in Google, with no AI
 * visibility.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'align_search_and_ai_content',
  code: 'F13',
  version: 1,
  category: 'fix',
  name: 'Fix Search-to-AI Content Misalignment',
  signalKinds: ['search_ai_misalignment'],
  requires: ['tracking', 'search_console'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_gsc_demand',
    'map_queries_to_prompts',
    'analyze_ai_responses',
    'analyze_prompt_gap',
    'identify_content_gaps',
    'optimize_content',
    'strengthen_reference_asset',
    'publish_content',
    'validate_gsc',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
