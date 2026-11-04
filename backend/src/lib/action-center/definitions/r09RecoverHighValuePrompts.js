/**
 * R09 — Recover High-Value Prompt Coverage.
 *
 * Signal: High-demand prompts losing the brand’s presence.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'recover_high_value_prompts',
  code: 'R09',
  version: 1,
  category: 'recover',
  name: 'Recover High-Value Prompt Coverage',
  signalKinds: ['high_value_prompt_lost'],
  requires: ['tracking', 'volumes'],
  optional: ['competitors'],
  enabled: true,
  tasks: [
    'analyze_prompt_gap',
    'prioritize_targets',
    'map_prompts_to_content',
    'analyze_competitor_visibility',
    'analyze_citations',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
