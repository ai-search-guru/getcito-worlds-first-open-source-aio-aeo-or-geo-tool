/**
 * F11 — Fix Prompt-to-Content Coverage.
 *
 * Signal: Tracked prompts with no owned page mapped to them, and never cited.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_prompt_content_coverage',
  code: 'F11',
  version: 1,
  category: 'fix',
  name: 'Fix Prompt-to-Content Coverage',
  signalKinds: ['prompt_unmapped'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_prompt_gap',
    'map_prompts_to_content',
    'identify_new_content_need',
    'cluster_prompts',
    'create_content_brief',
    { branch: [['optimize_content'], ['create_content_draft']] },
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'prompts');
  },
};
