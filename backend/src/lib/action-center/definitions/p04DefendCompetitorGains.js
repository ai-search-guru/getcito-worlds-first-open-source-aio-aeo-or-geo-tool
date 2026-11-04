/**
 * P04 — Defend Against Competitor Gains.
 *
 * Signal: A competitor gaining fast while the brand still holds its position.
 */

import { competitorNames, targetPayload } from './_helpers.js';

export default {
  id: 'defend_competitor_gains',
  code: 'P04',
  version: 1,
  category: 'protect',
  name: 'Defend Against Competitor Gains',
  signalKinds: ['competitor_surge'],
  requires: ['tracking', 'competitors'],
  optional: [],
  enabled: true,
  tasks: [
    'analyze_competitor_visibility',
    'analyze_competitor_citations',
    'analyze_competitor_content',
    'cluster_prompts',
    'identify_content_gaps',
    { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
    'validate_competitive_gap',
    'measure_action_outcome',
  ],

  payload(byKind) {
    return { ...targetPayload(byKind, 'competitors'), competitorNames: competitorNames(byKind) };
  },
};
