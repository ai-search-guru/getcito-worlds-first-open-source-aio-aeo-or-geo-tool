/**
 * F04 — Fix Content Gaps.
 *
 * Signal: Audited pages that do not cover the queries they target.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'fix_content_gaps',
  code: 'F04',
  version: 1,
  category: 'fix',
  name: 'Fix Content Gaps',
  signalKinds: ['content_gap'],
  requires: ['site_audits'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_ai_responses',
    'analyze_prompt_gap',
    'map_prompts_to_content',
    'identify_content_gaps',
    'create_content_brief',
    { branch: [['optimize_content'], ['create_content_draft']] },
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'pages');
  },
};
