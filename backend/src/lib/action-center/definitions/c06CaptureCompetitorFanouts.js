/**
 * C06 — Capture Competitor Query Fan-Outs.
 *
 * Signal: Fan-out queries where competitors appear and the brand does not.
 */

import { targetPayload } from './_helpers.js';

export default {
  id: 'capture_competitor_fanouts',
  code: 'C06',
  version: 1,
  category: 'compete',
  name: 'Capture Competitor Query Fan-Outs',
  signalKinds: ['competitor_fanout_gap'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_fanout_gap',
    'analyze_competitor_visibility',
    'cluster_prompts',
    'map_prompts_to_content',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return targetPayload(byKind, 'queries');
  },
};
