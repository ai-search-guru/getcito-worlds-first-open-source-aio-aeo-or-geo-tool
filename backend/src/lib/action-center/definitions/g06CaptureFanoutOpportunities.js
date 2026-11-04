/**
 * G06 — Capture Query Fan-Out Opportunities.
 *
 * Signal: Fan-out queries the engines ran across several prompts, with no
 * brand presence.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'capture_fanout_opportunities',
  code: 'G06',
  version: 1,
  category: 'growth',
  name: 'Capture Query Fan-Out Opportunities',
  signalKinds: ['fanout_gap'],
  requires: ['tracking'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_fanout_gap',
    'cluster_prompts',
    'prioritize_targets',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'publish_content',
    'validate_ai_visibility',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
