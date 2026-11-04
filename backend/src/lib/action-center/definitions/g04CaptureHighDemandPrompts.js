/**
 * G04 — Capture High-Demand Prompts.
 *
 * Signal: High prompt demand and no AI visibility.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'capture_high_demand_prompts',
  code: 'G04',
  version: 1,
  category: 'growth',
  name: 'Capture High-Demand Prompts',
  signalKinds: ['high_demand_gap'],
  requires: ['tracking', 'volumes'],
  optional: ['search_console'],
  enabled: true,
  tasks: [
    'prioritize_targets',
    'analyze_prompt_gap',
    'analyze_gsc_demand',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
