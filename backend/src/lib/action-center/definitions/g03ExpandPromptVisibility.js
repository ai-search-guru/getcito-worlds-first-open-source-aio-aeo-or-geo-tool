/**
 * G03 — Expand Prompt Visibility.
 *
 * Signal: The brand is absent across tracked prompts it has been cited on
 * before.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'expand_prompt_visibility',
  code: 'G03',
  version: 1,
  category: 'growth',
  name: 'Expand Prompt Visibility',
  signalKinds: ['prompt_visibility_gap'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_prompt_gap',
    'analyze_ai_responses',
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
